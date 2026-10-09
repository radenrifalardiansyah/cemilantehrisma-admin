import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/db-retry';
import { guardStall, rowToSale, SaleError, type SaleRow } from '@/lib/stall-pos-server';
import { moveConsignStock, ConsignStockError } from '@/lib/consign-receipts';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan penjualan lapak: stok dikembalikan, baris bagi hasil dibatalkan, dan uang keluar dari
// dompet lapak. Hanya selama shift penjualannya masih terbuka (shift tertutup = kas sudah dihitung).
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const data = await req.json() as { reason?: string };
  const reason = (data.reason ?? '').trim().slice(0, 200);
  if (!reason) return Response.json({ error: 'Alasan pembatalan wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const [found] = await sql<SaleRow[]>`select * from stall_sales where id = ${id}`;
  if (!found) return Response.json({ error: 'Penjualan tidak ditemukan.' }, { status: 404 });
  const guard = await guardStall(req, 'delete', found.stall_id);
  if (guard instanceof Response) return guard;
  const { user, stall } = guard;

  try {
    const voided = await withDeadlockRetry(() => sql.begin(async tx => {
      const [sale] = await tx<SaleRow[]>`select * from stall_sales where id = ${id} for update`;
      if (sale.status !== 'paid') throw new SaleError('Penjualan ini sudah dibatalkan.');
      if (Number(sale.refund_total) > 0) throw new SaleError('Penjualan ini sudah punya retur sebagian — tidak bisa dibatalkan seluruhnya.');
      const [shift] = sale.shift_id ? await tx<{ status: string }[]>`select status from stall_shifts where id = ${sale.shift_id}` : [];
      if (!shift || shift.status !== 'open') throw new SaleError('Shift penjualan ini sudah ditutup — pembatalan hanya bisa selama shift masih terbuka.');

      // Penjualan yang bagi hasilnya sudah masuk rekap tidak boleh dibatalkan (angka rekap sudah dikunci).
      const [inSettlement] = await tx`select 1 from consign_sale_lines where sale_id = ${id} and settlement_id is not null limit 1`;
      if (inSettlement) throw new SaleError('Penjualan ini sudah masuk rekap bagi hasil penitip — batalkan rekapnya dulu.');

      const items = rowToSale(sale).items;
      for (const i of [...items].filter(x => x.kind === 'consign').sort((a, b) => a.productId.localeCompare(b.productId))) {
        await moveConsignStock(tx, {
          productId: i.productId, productName: i.name, stallId: stall.id, stallName: stall.name,
          delta: i.qty, type: 'void', receiptId: id, note: `Batal ${sale.invoice_no}`,
        });
      }
      const own = items.filter(x => x.kind === 'own');
      if (own.length > 0) {
        const deltas = new Map<string, number>(own.map(i => [i.productId, i.qty]));
        const { products } = await readProductsForDeltasPg(tx, deltas);
        const [wh] = stall.warehouse_id ? await tx<{ name: string }[]>`select name from warehouses where id = ${stall.warehouse_id}` : [];
        for (const [productId, delta] of [...deltas].sort(([a], [b]) => a.localeCompare(b))) {
          const product = products.get(productId)!;
          await applyStockDeltaPg(tx, { productId, product, warehouseId: stall.warehouse_id ?? undefined, delta });
          await writeStockLedgerEntryPg(tx, {
            productId, productName: product.name, warehouseId: stall.warehouse_id ?? undefined, warehouseName: wh?.name,
            type: 'in', qty: delta, note: `Batal penjualan lapak ${stall.name} - ${sale.invoice_no}`,
          });
        }
      }

      await tx`update consign_sale_lines set voided = true where sale_id = ${id}`;
      if (Number(sale.total) > 0) {
        await tx`
          insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
          values (${randomUUID()}, ${stall.id}, 'sale', ${-Number(sale.total)}, ${id}, ${`Batal ${sale.invoice_no}`}, ${user.username}, now())
        `;
      }
      const [row] = await tx<SaleRow[]>`
        update stall_sales set status = 'void', void_reason = ${reason}, voided_by = ${user.username}, voided_at = now() where id = ${id} returning *
      `;
      return row;
    }));
    await auditConsign(user, 'update', 'stall-sales', id, `Batal penjualan lapak ${voided.invoice_no}`, { status: 'paid' }, { status: 'void', reason });
    return Response.json({ sale: rowToSale(voided) });
  } catch (err) {
    if (err instanceof SaleError || err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
