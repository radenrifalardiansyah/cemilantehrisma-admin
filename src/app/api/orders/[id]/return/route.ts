import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { withDeadlockRetry } from '@/lib/db-retry';
import { guardWalletBalances, WalletBalanceError } from '@/lib/wallet-balance';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { logHistory } from '@/lib/history';
import { revalidateProductStock } from '@/lib/revalidate';
import { rowToOrder, OrderRow } from '@/lib/orders-pg';
import { computeReturn } from '@/lib/order-return';

type Ctx = { params: Promise<{ id: string }> };

interface OrderItem { productId?: string; name: string; weight?: string; qty: number; price: number; subtotal: number; costPrice?: number }
class ReturnValidationError extends Error {}

// Retur per item. Pesanan dikoreksi langsung (qty item, subtotal, diskon proporsional, total
// dikurangi) — jadi semua laporan (pendapatan, HPP) dan saldo dompet otomatis ikut turun, dan
// untuk pesanan kredit yang belum lunas, piutangnya otomatis ikut terpotong. Rinciannya dicatat
// di kolom `returns` sebagai jejak audit. Retur seluruh isi pesanan tidak lewat sini — pakai
// "Batalkan Pesanan" supaya semua jalur pembatalan (stok, status) tetap satu pintu.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'orders', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json() as { items?: { index: number; qty: number }[]; reason?: string; restock?: boolean };
  const requested = (body.items ?? []).filter(i => Number.isInteger(i.index) && Number(i.qty) > 0);
  if (requested.length === 0) return Response.json({ error: 'Pilih minimal 1 item untuk diretur.' }, { status: 400 });
  const restock = body.restock !== false;
  const reason = (body.reason ?? '').trim().slice(0, 200);
  const sql = getSql();

  let result: { before: ReturnType<typeof rowToOrder>; refund: number; stockTouched: boolean; after: ReturnType<typeof rowToOrder> };
  try {
    result = await withDeadlockRetry(() => sql.begin(async pgTx => {
      const [row] = await pgTx<OrderRow[]>`select * from orders where id = ${id} for update`;
      if (!row) throw new ReturnValidationError('Pesanan tidak ditemukan.');
      const order = rowToOrder(row);
      if (order.status === 'dibatalkan') throw new ReturnValidationError('Pesanan yang sudah dibatalkan tidak bisa diretur.');

      const oldItems = (order.items as OrderItem[]) ?? [];
      const returnQty = new Map<number, number>();
      for (const r of requested) returnQty.set(r.index, (returnQty.get(r.index) ?? 0) + Math.floor(Number(r.qty)));
      for (const [index, qty] of returnQty) {
        const it = oldItems[index];
        if (!it) throw new ReturnValidationError('Item retur tidak ditemukan di pesanan.');
        if (qty > it.qty) throw new ReturnValidationError(`Qty retur "${it.name}" melebihi qty pesanan (${it.qty}).`);
      }

      const newItems = oldItems
        .map((it, i) => {
          const q = returnQty.get(i) ?? 0;
          return q === 0 ? it : { ...it, qty: it.qty - q, subtotal: (it.qty - q) * it.price };
        })
        .filter(it => it.qty > 0);
      if (newItems.length === 0) {
        throw new ReturnValidationError('Semua item diretur — gunakan "Batalkan Pesanan" untuk membatalkan seluruh pesanan.');
      }

      const orderDiscount = order.discount as { amount: number; label: string } | null;
      const { newSubtotal, newDiscountAmount, newTotal, refund } = computeReturn(
        oldItems, orderDiscount?.amount ?? 0, order.total, i => returnQty.get(i) ?? 0,
      );
      const newDiscount = orderDiscount && newDiscountAmount > 0 ? { ...orderDiscount, amount: newDiscountAmount } : null;

      const stockCut = order.stockCut === true || (order.source === 'kasir' && order.stockCut === undefined);
      let stockTouched = false;
      if (restock && stockCut) {
        const deltas = new Map<string, number>();
        const resolve = async (it: OrderItem) => {
          if (it.productId) return it.productId;
          const rows = await pgTx<{ id: string }[]>`select id from products where name = ${it.name} limit 2`;
          return rows.length === 1 ? rows[0].id : undefined;
        };
        for (const [index, qty] of returnQty) {
          const pid = await resolve(oldItems[index]);
          if (pid) deltas.set(pid, (deltas.get(pid) ?? 0) + qty);
        }
        if (deltas.size > 0) {
          const { products } = await readProductsForDeltasPg(pgTx, deltas);
          for (const [productId, delta] of deltas) {
            const product = products.get(productId);
            if (!product) continue;
            await applyStockDeltaPg(pgTx, { productId, product, warehouseId: order.warehouseId, delta });
            await writeStockLedgerEntryPg(pgTx, {
              productId, productName: product.name, warehouseId: order.warehouseId, warehouseName: order.warehouseName,
              type: 'in', qty: delta, note: `Retur pesanan ${order.invoiceNo ?? ''}`,
            });
          }
          stockTouched = true;
        }
      }

      const entry = {
        at: new Date().toISOString(),
        by: guard.username,
        amount: refund,
        reason: reason || undefined,
        restocked: restock && stockCut,
        // Dari kredit belum lunas → memotong piutang; selain itu uang keluar dari dompet pesanan.
        settlement: order.paymentStatus === 'belum_lunas' ? 'potong_piutang' : 'dompet',
        items: [...returnQty].map(([index, qty]) => ({ name: oldItems[index].name, weight: oldItems[index].weight, qty, price: oldItems[index].price })),
      };
      const returns = [...(Array.isArray(order.returns) ? order.returns : []), entry];

      const apply = async () => {
        await pgTx`
          update orders set items = ${JSON.stringify(newItems)}, subtotal = ${newSubtotal},
            discount = ${newDiscount ? JSON.stringify(newDiscount) : null}, total = ${newTotal},
            returns = ${JSON.stringify(returns)}, updated_at = now()
          where id = ${id}
        `;
      };
      // Pesanan lunas: total turun = saldo dompet turun (uang dikembalikan). Pastikan tidak minus.
      if (order.paymentStatus !== 'belum_lunas' && order.walletId && order.status !== 'baru') {
        await guardWalletBalances(pgTx, [order.walletId], apply);
      } else {
        await apply();
      }

      const [after] = await pgTx<OrderRow[]>`select * from orders where id = ${id}`;
      return { before: order, refund, stockTouched, after: rowToOrder(after) };
    }));
  } catch (err) {
    if (err instanceof ReturnValidationError || err instanceof WalletBalanceError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal memproses retur.' }, { status: 400 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'orders', entityId: id, entityLabel: `Pesanan ${result.before.invoiceNo ?? id}`,
      action: 'update', actor: guard, before: result.before, after: result.after,
    });
  } catch (err) {
    console.error('Failed to write history for order return', err);
  }
  // Salinan invoice storefront (link PDF yang dikirim ke pelanggan) ikut diperbarui.
  try {
    const a = result.after;
    await sql`
      update invoices set items = ${JSON.stringify(a.items)}, subtotal = ${a.subtotal},
        discount = ${a.discount ? JSON.stringify(a.discount) : null}, total = ${a.total}
      where invoice_no = ${a.invoiceNo}
    `;
  } catch (err) {
    console.error('Failed to sync invoice after return', err);
  }
  if (result.stockTouched) revalidateProductStock();
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, refund: result.refund, settlement: result.after.paymentStatus === 'belum_lunas' ? 'potong_piutang' : 'dompet' });
}
