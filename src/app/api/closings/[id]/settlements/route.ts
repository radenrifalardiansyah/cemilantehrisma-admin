import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { parseMoneyAmount } from '@/lib/validate-input';
import { SettlementError, linkExistingTransfer, unlinkSettlement, type AppliedLinks } from '@/lib/closing-settlement';
import { logLinkChanges } from '@/lib/closing-settlement-history';
import { TransferValidationError, createWalletTransfer, parseTransferInput } from '@/lib/wallet-transfers-pg';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

// Buat tautan transfer <-> closing dari sisi Closing.
//  { mode: 'link', walletTransferId, amount }                     -> tautkan transfer yang SUDAH ADA (nominal tautan = amount)
//  { mode: 'new', fromWalletId, toWalletId, amount, date, note,   -> buat transfer baru + tautan dalam SATU transaksi DB
//    linkAmount? }                                                   (nominal tautan default = min(amount, sisa HPP))
// Izin: Dompet 'create' + akses baca Laporan Produk (closing). Tidak mengubah saldo selain transfer baru (mode 'new').
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'create');
  if (guard instanceof Response) return guard;
  if (!(await hasPermission(guard, 'product-report', 'view'))) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id: closingId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();

  let transferId: string;
  let applied: AppliedLinks;
  let transferLabel: string;
  let isNew = false;
  try {
    if (body.mode === 'new') {
      const parsed = parseTransferInput(body);
      if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
      const linkAmount = body.linkAmount === undefined ? parsed.input.amount : parseMoneyAmount(body.linkAmount);
      if (linkAmount === null || linkAmount <= 0) return Response.json({ error: 'Nominal tautan closing harus lebih dari 0.' }, { status: 400 });
      const created = await createWalletTransfer(sql, db, parsed.input, [{ closingId, amount: Math.min(linkAmount, parsed.input.amount) }], guard.username);
      transferId = created.id; applied = created.applied; isNew = true;
      transferLabel = `${created.fromName} → ${created.toName} - Rp${parsed.input.amount.toLocaleString('id-ID')}`;
      try {
        await logHistory(db, {
          entity: 'wallet-transfers', entityId: created.id, entityLabel: transferLabel, action: 'create', actor: guard,
          after: { ...parsed.input, closingLinks: [{ closingId, amount: Math.min(linkAmount, parsed.input.amount) }] },
        });
      } catch (err) { console.error('Failed to write history for wallet-transfers create', err); }
    } else if (body.mode === 'link') {
      const walletTransferId = typeof body.walletTransferId === 'string' ? body.walletTransferId : '';
      const amount = parseMoneyAmount(body.amount);
      if (!walletTransferId) return Response.json({ error: 'Transfer wajib dipilih.' }, { status: 400 });
      if (amount === null || amount <= 0) return Response.json({ error: 'Nominal tautan harus lebih dari 0.' }, { status: 400 });
      const r = await linkExistingTransfer(sql, { closingId, transferId: walletTransferId, amount, username: guard.username });
      transferId = r.transfer.id; applied = r.applied;
      transferLabel = `Transfer Rp${r.transfer.amount.toLocaleString('id-ID')} (${r.transfer.date})`;
    } else {
      return Response.json({ error: 'Mode tidak dikenal.' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof SettlementError || err instanceof TransferValidationError) return Response.json({ error: err.message }, { status: 400 });
    console.error('Gagal menautkan transfer ke closing', err);
    return Response.json({ error: 'Gagal menautkan transfer ke closing.' }, { status: 500 });
  }

  await logLinkChanges(db, guard, { transferId, transferLabel, diff: applied, periodTo: applied.periodTo, logTransfer: !isNew });
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ ok: true, transferId });
}

// Lepas satu tautan: DELETE /api/closings/[id]/settlements?settlementId=... — izin Dompet 'edit'.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'edit');
  if (guard instanceof Response) return guard;
  if (!(await hasPermission(guard, 'product-report', 'view'))) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id: closingId } = await ctx.params;
  const settlementId = new URL(req.url).searchParams.get('settlementId') ?? '';
  if (!settlementId) return Response.json({ error: 'settlementId wajib diisi.' }, { status: 400 });

  let r: Awaited<ReturnType<typeof unlinkSettlement>>;
  try {
    r = await unlinkSettlement(getSql(), { closingId, settlementId });
  } catch (err) {
    if (err instanceof SettlementError) return Response.json({ error: err.message }, { status: 404 });
    console.error('Gagal melepas tautan transfer', err);
    return Response.json({ error: 'Gagal melepas tautan transfer.' }, { status: 500 });
  }
  await logLinkChanges(getDb(), guard, {
    transferId: r.transferId, transferLabel: `Transfer ${r.transferId}`, logTransfer: true,
    diff: { added: [], changed: [], removed: [{ closingId, amount: r.amount }] }, periodTo: { [closingId]: r.periodTo },
  });
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ ok: true });
}
