import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { parseMoneyAmount } from '@/lib/validate-input';
import { computeWalletBalance, guardWalletBalances, WalletBalanceError } from '@/lib/wallet-balance';
import { logHistory } from '@/lib/history';
import {
  SettlementError, applyTransferLinks, linkedTotalOfTransfer, lockTransferRow, parseLinks, releaseTransferLinks, transferAmountProblem,
  type AppliedLinks, type LinkInput,
} from '@/lib/closing-settlement';
import { logLinkChanges } from '@/lib/closing-settlement-history';

type Ctx = { params: Promise<{ id: string }> };

class TransferValidationError extends Error {}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();

  const fromWalletId = typeof data.fromWalletId === 'string' ? data.fromWalletId : '';
  const toWalletId = typeof data.toWalletId === 'string' ? data.toWalletId : '';
  const amount = parseMoneyAmount(data.amount) ?? 0;
  if (!fromWalletId || !toWalletId) return Response.json({ error: 'Dompet asal dan tujuan wajib diisi.' }, { status: 400 });
  if (fromWalletId === toWalletId) return Response.json({ error: 'Dompet asal dan tujuan tidak boleh sama.' }, { status: 400 });
  if (amount <= 0) return Response.json({ error: 'Jumlah transfer harus lebih dari 0.' }, { status: 400 });

  // `closingLinks` (opsional): undefined = tautan tidak diubah; array = SELURUH tautan transfer ini (set pengganti).
  // Mengubah tautan: butuh akses baca product-report (pemilih closing); melepas tautan sudah tercakup izin edit Dompet.
  let links: LinkInput[] | undefined;
  if (data.closingLinks !== undefined) {
    const pl = parseLinks(data.closingLinks);
    if ('error' in pl) return Response.json({ error: pl.error }, { status: 400 });
    if (pl.links.length > 0 && !(await hasPermission(guard, 'product-report', 'view'))) {
      return Response.json({ error: 'Anda tidak punya akses untuk menautkan transfer ke closing.' }, { status: 403 });
    }
    links = pl.links;
  }

  const sql = getSql();
  const [fromRow, toRow] = await Promise.all([
    sql<{ name: string; initial_balance: string }[]>`select name, initial_balance from wallets where id = ${fromWalletId}`,
    sql<{ name: string }[]>`select name from wallets where id = ${toWalletId}`,
  ]);
  if (!fromRow[0]) return Response.json({ error: 'Dompet asal tidak ditemukan.' }, { status: 400 });
  if (!toRow[0]) return Response.json({ error: 'Dompet tujuan tidak ditemukan.' }, { status: 400 });
  const fromName = fromRow[0].name ?? fromWalletId;
  const toName = toRow[0].name ?? toWalletId;
  const fromInitialBalance = Number(fromRow[0].initial_balance) || 0;
  let before: WalletTransferRow | undefined;
  let update: Record<string, unknown>;
  let applied = null as AppliedLinks | null;
  try {
    update = await sql.begin(async (pgTx) => {
      // Sama seperti POST /api/wallet-transfers: kunci baris dompet asal supaya edit transfer ini
      // tidak balapan (TOCTOU) dengan transfer lain (POST/PUT) dari dompet yang sama yang tiba
      // hampir bersamaan — tanpa ini, lock di POST tidak berarti apa-apa karena PUT bisa
      // menyelinap tanpa ikut menunggu giliran.
      await pgTx`select pg_advisory_xact_lock(hashtext(${fromWalletId}))`;
      // Kunci baris transfer (urutan kunci: dompet -> baris transfer -> closings) supaya tautan closing
      // yang dibuat bersamaan dari sisi Closing tidak menyelinap di antara cek jumlah dan update.
      const locked = await lockTransferRow(pgTx, id);
      if (!locked) throw new TransferValidationError('Transfer tidak ditemukan.');
      const [existing] = await pgTx<WalletTransferRow[]>`select * from wallet_transfers where id = ${id}`;
      before = existing;

      // Hitung saldo dompet asal TANPA transfer ini (excludeTransferId) — supaya edit transfer
      // yang sama (mis. cuma ganti catatan) tidak keblokir oleh kontribusi transfer itu sendiri.
      const fromBalance = await computeWalletBalance(db, fromWalletId, fromInitialBalance, id, undefined, pgTx);
      if (amount > fromBalance) {
        throw new TransferValidationError(`Saldo "${fromName}" tidak cukup (saldo saat ini Rp${Math.round(fromBalance).toLocaleString('id-ID')}).`);
      }

      const newDate = typeof data.date === 'string' && data.date ? data.date : existing.date;
      const newNote = (data.note as string | undefined) ?? '';
      await pgTx`
        update wallet_transfers
        set from_wallet_id = ${fromWalletId}, to_wallet_id = ${toWalletId}, amount = ${amount},
            date = ${newDate}, note = ${newNote}, updated_at = now()
        where id = ${id}
      `;
      // Jumlah tak boleh turun di bawah total tautan; bila tautan dikirim, validasi alokasi memakai jumlah baru.
      if (links === undefined) {
        const problem = transferAmountProblem(amount, await linkedTotalOfTransfer(pgTx, id));
        if (problem) throw new TransferValidationError(problem);
      } else {
        applied = await applyTransferLinks(pgTx, { transferId: id, transferAmount: amount, links, username: guard.username });
      }
      return { fromWalletId, toWalletId, amount, date: newDate, note: newNote };
    });
  } catch (err) {
    if (err instanceof SettlementError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof TransferValidationError) {
      const status = err.message === 'Transfer tidak ditemukan.' ? 404 : 400;
      return Response.json({ error: err.message }, { status });
    }
    throw err;
  }

  try {
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: id,
      entityLabel: `${fromName} → ${toName} - Rp${amount.toLocaleString('id-ID')}`,
      action: 'update',
      actor: guard,
      before: before ? { fromWalletId: before.from_wallet_id, toWalletId: before.to_wallet_id, amount: Number(before.amount), date: before.date, note: before.note } : null,
      after: update,
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers update', err);
  }
  if (applied) await logLinkChanges(db, guard, { transferId: id, transferLabel: `${fromName} → ${toName} - Rp${amount.toLocaleString('id-ID')}`, diff: applied, periodTo: applied.periodTo, logTransfer: true });
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<WalletTransferRow[]>`select * from wallet_transfers where id = ${id}`;
  let released = [] as Awaited<ReturnType<typeof releaseTransferLinks>>;
  try {
    await sql.begin(async pgTx => {
      await guardWalletBalances(pgTx, [before?.from_wallet_id, before?.to_wallet_id], async () => {
        // Tautan closing dilepas otomatis (FK RESTRICT) — setelah kunci dompet & baris transfer (urutan kunci seragam).
        await lockTransferRow(pgTx, id);
        released = await releaseTransferLinks(pgTx, [id]);
        await pgTx`delete from wallet_transfers where id = ${id}`;
      });
    });
  } catch (err) {
    if (err instanceof WalletBalanceError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  try {
    const db = getDb();
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: id,
      entityLabel: before ? `Rp${Number(before.amount ?? 0).toLocaleString('id-ID')}` : id,
      action: 'delete',
      actor: guard,
      before: before ? { fromWalletId: before.from_wallet_id, toWalletId: before.to_wallet_id, amount: Number(before.amount), date: before.date, note: before.note, ...(released.length > 0 ? { closingLinks: released.map(r => ({ closingId: r.closingId, amount: r.amount })) } : {}) } : null,
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers delete', err);
  }
  if (released.length > 0) {
    await logLinkChanges(getDb(), guard, {
      transferId: id, transferLabel: '', reason: 'Transfer dihapus',
      diff: { added: [], changed: [], removed: released.map(r => ({ closingId: r.closingId, amount: r.amount })) },
      periodTo: Object.fromEntries(released.map(r => [r.closingId, r.periodTo])),
    });
  }
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ ok: true });
}

interface WalletTransferRow {
  id: string; from_wallet_id: string; to_wallet_id: string; amount: string; date: string; note: string | null;
  created_at: Date; updated_at: Date | null;
}
