import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { parseDateKey } from '@/lib/validate-input';
import { WalletBalanceError } from '@/lib/wallet-balance';
import { PaymentError } from '@/lib/payables-core';
import { addPurchasePaymentTx } from '@/lib/purchase-payments';

type Ctx = { params: Promise<{ id: string }> };

// Tandai Lunas = bayar SELURUH SISA hutang sekaligus: dibuat SATU pembayaran sebesar sisa (baris
// material_purchase_payments + pengeluaran pasangannya), lewat fungsi yang sama dengan cicilan — baru di sini
// uang benar-benar keluar, supaya tidak dobel hitung dengan pengeluaran yang seharusnya sudah dicatat kalau langsung lunas.
// Body opsional: { date?, walletId?, note? }. Default dompet = dompet pembelian; default tanggal = tanggal pembelian bila
// belum ada cicilan (perilaku lama, bisa mundur), selain itu hari ini.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { date?: unknown; walletId?: string | null; note?: unknown };
  if (body.date !== undefined && body.date !== null && body.date !== '' && !parseDateKey(body.date)) {
    return Response.json({ error: 'Tanggal bayar tidak valid (format YYYY-MM-DD).' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const sql = getSql();
  let result: Awaited<ReturnType<typeof addPurchasePaymentTx>> | null = null;
  let alreadyPaid = false;
  try {
    await sql.begin(async pgTx => {
      const [row] = await pgTx<{ payment_status: string; voided: boolean; wallet_id: string | null; date: string }[]>`
        select payment_status, voided, wallet_id, date from material_purchases where id = ${id} for update
      `;
      if (!row) throw new PaymentError('Pembelian tidak ditemukan.');
      if (row.voided) throw new PaymentError('Pembelian ini sudah dibatalkan dan tidak bisa ditandai lunas.');
      if (row.payment_status === 'lunas') { alreadyPaid = true; return; } // sudah lunas, tidak perlu apa-apa
      const [{ n }] = await pgTx<{ n: number }[]>`select count(*)::int as n from material_purchase_payments where purchase_id = ${id} and not voided`;
      const date = body.date ? parseDateKey(body.date)! : (n === 0 ? row.date : parseDateKey(undefined)!);
      result = await addPurchasePaymentTx(pgTx, { purchaseId: id, amount: null, date, walletId: body.walletId || row.wallet_id, note: note || 'ditandai lunas', actor: guard.username });
    });
  } catch (err) {
    if (err instanceof PaymentError || err instanceof WalletBalanceError) return Response.json({ error: err.message }, { status: 400 });
    console.error('Failed to mark material purchase lunas', err);
    return Response.json({ error: 'Gagal menandai lunas.' }, { status: 500 });
  }

  const done = result as Awaited<ReturnType<typeof addPurchasePaymentTx>> | null;
  if (!alreadyPaid && done) {
    try {
      await logHistory(getDb(), {
        entity: 'material-purchases', entityId: id,
        entityLabel: `${done.before.supplierName?.trim() || 'Tanpa nama'} - Rp${done.before.total}`,
        action: 'update', actor: guard, before: done.before,
        after: { ...done.before, paymentStatus: 'lunas', paidAmount: done.paidAfter, remaining: 0 },
        meta: { payment: { id: done.paymentId, amount: done.amount }, settled: true, via: 'mark-lunas' },
      });
    } catch (err) {
      console.error('Failed to write history for material purchase mark-lunas', err);
    }
    if (done.amount > 0) revalidateTag('admin-expenses', { expire: 0 });
    revalidateTag('admin-analytics', { expire: 0 });
  }

  return Response.json({ ok: true });
}
