import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/db-retry';
import { wibDateKey } from '@/lib/date';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { guardStall, rowToSale, SaleError, type SaleRow } from '@/lib/stall-pos-server';
import { computeReturn, type ReturnSelection } from '@/lib/stall-return';
import { moveConsignStock, ConsignStockError } from '@/lib/consign-receipts';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

// Retur SEBAGIAN penjualan lapak (pelanggan mengembalikan sebagian barang): stok barang yang diretur
// kembali, uang dikembalikan (dikurangi bagian diskon proporsional), dan bagi hasil penitip dikoreksi
// dengan baris negatif. Seperti pembatalan: hanya selama shift penjualannya masih terbuka, dan hanya
// kalau bagi hasil barang itu belum masuk rekap. Izin 'stall-pos' delete (sama dengan pembatalan).
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const data = await req.json() as { items?: ReturnSelection[]; reason?: string };
  const reason = (data.reason ?? '').trim().slice(0, 200);
  if (!reason) return Response.json({ error: 'Alasan retur wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const [found] = await sql<SaleRow[]>`select * from stall_sales where id = ${id}`;
  if (!found) return Response.json({ error: 'Penjualan tidak ditemukan.' }, { status: 404 });
  const guard = await guardStall(req, 'delete', found.stall_id);
  if (guard instanceof Response) return guard;
  const { user, stall } = guard;
  const selections = (Array.isArray(data.items) ? data.items : []).map(s => ({ index: Number(s?.index), qty: Number(s?.qty) }));

  try {
    const outcome = await withDeadlockRetry(() => sql.begin(async tx => {
      const [sale] = await tx<SaleRow[]>`select * from stall_sales where id = ${id} for update`;
      if (sale.status !== 'paid') throw new SaleError('Penjualan ini sudah dibatalkan.');
      const [shift] = sale.shift_id ? await tx<{ status: string }[]>`select status from stall_shifts where id = ${sale.shift_id}` : [];
      if (!shift || shift.status !== 'open') throw new SaleError('Shift penjualan ini sudah ditutup — retur hanya bisa selama shift masih terbuka.');

      const items = rowToSale(sale).items;
      const calc = computeReturn(items, Number(sale.subtotal), Number(sale.discount), selections);
      if ('error' in calc) throw new SaleError(calc.error);

      const dateKey = wibDateKey(new Date());
      const prefix = stall.invoice_prefix ?? stall.code ?? 'LPK';
      const returnId = randomUUID();
      const docNumber = await nextDocNumber(tx, `RET-${prefix}`, periodOf(dateKey));

      const consignLines = calc.lines.filter(l => items[l.index].kind === 'consign').sort((a, b) => items[a.index].productId.localeCompare(items[b.index].productId));
      for (const l of consignLines) {
        const it = items[l.index];
        // Bagi hasil barang ini sudah direkap → tidak boleh dikoreksi diam-diam (angka rekap sudah dikunci).
        const [settled] = await tx`select 1 from consign_sale_lines where sale_id = ${id} and product_id = ${it.productId} and settlement_id is not null limit 1`;
        if (settled) throw new SaleError(`${it.name}: bagi hasil penjualan ini sudah masuk rekap — batalkan rekapnya dulu.`);
        await moveConsignStock(tx, { productId: it.productId, productName: it.name, stallId: stall.id, stallName: stall.name, delta: l.qty, type: 'sale_return', receiptId: returnId, note: docNumber });
        await tx`
          insert into consign_sale_lines (id, sale_id, stall_id, consignor_id, consignor_name, product_id, product_name, qty, price, scheme, scheme_value,
            consignor_amount, our_amount, return_id, created_at)
          values (${randomUUID()}, ${id}, ${stall.id}, ${it.consignorId!}, ${it.consignorName!}, ${it.productId}, ${it.name}, ${-l.qty}, ${it.price},
            ${it.scheme!}, ${it.schemeValue ?? 0}, ${-(it.consignorShare ?? 0) * l.qty}, ${-(it.ourShare ?? 0) * l.qty}, ${returnId}, now())
        `;
      }
      const ownLines = calc.lines.filter(l => items[l.index].kind === 'own');
      if (ownLines.length > 0) {
        if (!stall.warehouse_id) throw new SaleError('Lapak ini tidak punya gudang terkait — stok produk toko tidak bisa dikembalikan.');
        const deltas = new Map<string, number>();
        for (const l of ownLines) deltas.set(items[l.index].productId, (deltas.get(items[l.index].productId) ?? 0) + l.qty);
        const { products } = await readProductsForDeltasPg(tx, deltas);
        const [wh] = await tx<{ name: string }[]>`select name from warehouses where id = ${stall.warehouse_id}`;
        for (const [productId, delta] of [...deltas].sort(([a], [b]) => a.localeCompare(b))) {
          const product = products.get(productId)!;
          await applyStockDeltaPg(tx, { productId, product, warehouseId: stall.warehouse_id, delta });
          await writeStockLedgerEntryPg(tx, {
            productId, productName: product.name, warehouseId: stall.warehouse_id, warehouseName: wh?.name,
            type: 'in', qty: delta, note: `Retur penjualan lapak ${stall.name} - ${sale.invoice_no}`,
          });
        }
      }

      // Catat jumlah yang sudah diretur di item penjualan (dipakai laporan & retur berikutnya).
      const updated = items.map((it, i) => {
        const l = calc.lines.find(x => x.index === i);
        return l ? { ...it, returnedQty: (it.returnedQty ?? 0) + l.qty } : it;
      });
      await tx`update stall_sales set items = ${tx.json(updated as never)}, refund_total = refund_total + ${calc.refund} where id = ${id}`;
      await tx`
        insert into stall_sale_returns (id, doc_number, sale_id, stall_id, items, refund_amount, reason, created_by, created_at)
        values (${returnId}, ${docNumber}, ${id}, ${stall.id}, ${tx.json(calc.lines.map(l => ({ name: items[l.index].name, qty: l.qty, price: items[l.index].price })) as never)},
          ${calc.refund}, ${reason}, ${user.username}, now())
      `;
      if (calc.refund > 0) {
        await tx`
          insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
          values (${randomUUID()}, ${stall.id}, 'sale', ${-calc.refund}, ${id}, ${`Retur ${sale.invoice_no} (${docNumber})`}, ${user.username}, now())
        `;
      }
      const [row] = await tx<SaleRow[]>`select * from stall_sales where id = ${id}`;
      return { docNumber, refund: calc.refund, sale: row };
    }));
    await auditConsign(user, 'update', 'stall-sales', id, `Retur ${outcome.sale.invoice_no}`, null, { docNumber: outcome.docNumber, refund: outcome.refund, reason });
    return Response.json({ docNumber: outcome.docNumber, refund: outcome.refund, sale: rowToSale(outcome.sale) });
  } catch (err) {
    if (err instanceof SaleError || err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
