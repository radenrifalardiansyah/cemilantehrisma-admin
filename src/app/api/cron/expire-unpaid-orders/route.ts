import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { logHistory } from '@/lib/history';
import { rowToOrder, OrderRow } from '@/lib/orders-pg';
import { orderClosingLock } from '@/lib/closing';
import { paidAmountOf } from '@/lib/order-payments-pg';
import { applyOrderCancellationInTx } from '@/lib/order-cancel';
import { UNPAID_ORDER_EXPIRY_HOURS, expiryCutoff, isExpirableUnpaidOrder } from '@/lib/order-expiry';
import { revalidateProductStock, revalidateStorefront } from '@/lib/revalidate';

// Batalkan otomatis pesanan website yang belum dibayar > 24 jam (lihat src/lib/order-expiry.ts): dipanggil terjadwal
// oleh GitHub Actions (.github/workflows/expire-unpaid-orders.yml). Pesanan yang sudah upload bukti bayar, sudah
// punya cicilan, sudah Closing, atau sudah diproses/dikirim TIDAK disentuh. Tiap pesanan dibatalkan di transaksinya
// sendiri (row lock + cek ulang kondisi) memakai logika pembatalan yang sama dengan jalur admin.
// Wajib CRON_SECRET: tanpa itu endpoint ditolak (bukan dibuka), supaya tidak bisa dipicu orang luar.
const MAX_PER_RUN = 200;
const TIME_BUDGET_MS = 50_000;
const REASON = `Dibatalkan otomatis: belum dibayar ${UNPAID_ORDER_EXPIRY_HOURS} jam`;
const SYSTEM_ACTOR = { username: 'sistem', role: 'system' };

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getSql();
  const db = getDb();
  const startedAt = Date.now();
  const now = new Date();
  const cutoff = expiryCutoff(now);

  // Kandidat kasar lewat query; syarat sebenarnya dicek ulang di dalam transaksi setelah baris dikunci.
  const candidates = await sql<{ id: string }[]>`
    select o.id from orders o
    where o.source = 'portal' and o.status = 'baru' and o.payment_status = 'belum_lunas'
      and coalesce(btrim(o.transfer_proof_url), '') = ''
      and o.fulfillment_status is null
      and o.created_at < ${cutoff}
      and not exists (select 1 from order_payments p where p.order_id = o.id)
    order by o.created_at asc
    limit ${MAX_PER_RUN}
  `;

  let skipped = 0, failed = 0, stockTouched = false, truncated = false;
  const cancelledInvoices: string[] = [];
  // Berurutan sengaja: tiap pesanan transaksi sendiri dengan row lock + kunci produk/voucher; paralel hanya
  // menambah kontensi lock tanpa untung berarti pada batas 200 per run.
  for (const { id } of candidates) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) { truncated = true; break; }
    try {
      const result = await sql.begin(async pgTx => {
        const [orderRow] = await pgTx<OrderRow[]>`select * from orders where id = ${id} for update`;
        if (!orderRow) return null;
        const order = rowToOrder(orderRow);
        // Cek ulang setelah lock: admin bisa baru menandai lunas/membatalkan/memproses, pelanggan baru upload bukti.
        const stillExpirable = isExpirableUnpaidOrder({
          source: order.source, status: order.status, paymentStatus: order.paymentStatus,
          transferProofUrl: order.transferProofUrl, fulfillmentStatus: order.fulfillmentStatus,
          createdAtMs: orderRow.created_at.getTime(),
        }, now.getTime());
        if (!stillExpirable) return null;
        if (await orderClosingLock(pgTx, id)) return null;
        if (await paidAmountOf(pgTx, id) > 0) return null;
        const extraCols = await applyOrderCancellationInTx(pgTx, order, { orderId: id, username: SYSTEM_ACTOR.username });
        const updateCols: Record<string, unknown> = { status: 'dibatalkan', updated_at: new Date(), ...extraCols };
        await pgTx`update orders set ${pgTx(updateCols, ...Object.keys(updateCols))} where id = ${id}`;
        return order;
      });
      if (!result) { skipped++; continue; }
      cancelledInvoices.push(result.invoiceNo || id);
      stockTouched = true;
      try {
        await logHistory(db, {
          entity: 'orders', entityId: id, entityLabel: `Pesanan ${result.invoiceNo || id}`,
          action: 'update', actor: SYSTEM_ACTOR, before: result, after: { status: 'dibatalkan', note: REASON },
          meta: { auto: true, reason: REASON },
        });
      } catch (err) {
        console.error('Failed to write history for auto-cancelled order', id, err);
      }
    } catch (err) {
      failed++;
      console.error('Failed to auto-cancel unpaid order', id, err);
    }
  }

  const cancelled = cancelledInvoices.length;
  const summary = { cancelled, skipped, failed, truncated, notified: false };
  if (cancelled === 0) return Response.json(summary);

  if (stockTouched) revalidateProductStock();
  revalidateTag('admin-analytics', { expire: 0 });
  after(() => revalidateStorefront('stats'));

  const shown = cancelledInvoices.slice(0, 5).join(', ');
  try {
    await notify(db, {
      type: 'system',
      title: 'Pesanan dibatalkan otomatis',
      message: `${cancelled} pesanan website dibatalkan otomatis karena belum dibayar > ${UNPAID_ORDER_EXPIRY_HOURS} jam (${shown}${cancelled > 5 ? `, +${cancelled - 5} lainnya` : ''}). Stok dan kuota voucher sudah dikembalikan.`,
      link: 'orders',
      actor: SYSTEM_ACTOR,
    });
    summary.notified = true;
  } catch (err) {
    console.error('Failed to send auto-cancel notification', err);
  }
  return Response.json(summary);
}
