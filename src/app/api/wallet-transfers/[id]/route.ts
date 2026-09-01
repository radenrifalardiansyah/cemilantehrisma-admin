import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { computeWalletBalance } from '@/lib/wallet-balance';
import { logHistory } from '@/lib/history';

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
  const amount = Number(data.amount) || 0;
  if (!fromWalletId || !toWalletId) return Response.json({ error: 'Dompet asal dan tujuan wajib diisi.' }, { status: 400 });
  if (fromWalletId === toWalletId) return Response.json({ error: 'Dompet asal dan tujuan tidak boleh sama.' }, { status: 400 });
  if (amount <= 0) return Response.json({ error: 'Jumlah transfer harus lebih dari 0.' }, { status: 400 });

  const [fromSnap, toSnap] = await Promise.all([
    db.collection('wallets').doc(fromWalletId).get(),
    db.collection('wallets').doc(toWalletId).get(),
  ]);
  if (!fromSnap.exists) return Response.json({ error: 'Dompet asal tidak ditemukan.' }, { status: 400 });
  if (!toSnap.exists) return Response.json({ error: 'Dompet tujuan tidak ditemukan.' }, { status: 400 });
  const fromName = fromSnap.data()?.name ?? fromWalletId;
  const toName = toSnap.data()?.name ?? toWalletId;

  const sql = getSql();
  let before: WalletTransferRow | undefined;
  let update: Record<string, unknown>;
  try {
    update = await sql.begin(async (pgTx) => {
      const [existing] = await pgTx<WalletTransferRow[]>`select * from wallet_transfers where id = ${id}`;
      if (!existing) throw new TransferValidationError('Transfer tidak ditemukan.');
      before = existing;

      // Hitung saldo dompet asal TANPA transfer ini (excludeTransferId) — supaya edit transfer
      // yang sama (mis. cuma ganti catatan) tidak keblokir oleh kontribusi transfer itu sendiri.
      const fromBalance = await computeWalletBalance(db, fromWalletId, Number(fromSnap.data()?.initialBalance) || 0, id, undefined, pgTx);
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
      return { fromWalletId, toWalletId, amount, date: newDate, note: newNote };
    });
  } catch (err) {
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
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<WalletTransferRow[]>`select * from wallet_transfers where id = ${id}`;
  await sql`delete from wallet_transfers where id = ${id}`;
  try {
    const db = getDb();
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: id,
      entityLabel: before ? `Rp${Number(before.amount ?? 0).toLocaleString('id-ID')}` : id,
      action: 'delete',
      actor: guard,
      before: before ? { fromWalletId: before.from_wallet_id, toWalletId: before.to_wallet_id, amount: Number(before.amount), date: before.date, note: before.note } : null,
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers delete', err);
  }
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ ok: true });
}

interface WalletTransferRow {
  id: string; from_wallet_id: string; to_wallet_id: string; amount: string; date: string; note: string | null;
  created_at: Date; updated_at: Date | null;
}
