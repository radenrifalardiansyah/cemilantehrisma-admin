import { randomUUID } from 'crypto';
import type { TransactionSql } from 'postgres';
import { wibDateKey } from '@/lib/date';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { moveConsignStock } from '@/lib/consign-receipts';
import { pricingFromRow, rowToSale, SaleError, type ConsignPricingRow, type SaleItem, type SaleRow } from '@/lib/stall-pos-server';
import type { StallRow } from '@/lib/consign-pg';
import type { getSql } from '@/lib/db';

type Tx = TransactionSql;

// Jual barang titipan: harga & bagi hasil dihitung di server, stok titipan lapak berkurang. Dipakai Kasir
// Lapak dan Kasir toko (lapak bertanda "Toko"). Baris diurutkan per produk (urutan kunci seragam).
export async function sellConsignLines(
  tx: Tx, p: { stall: { id: string; name: string }; lines: { productId: string; qty: number }[]; saleId: string; invoiceNo: string },
): Promise<SaleItem[]> {
  const items: SaleItem[] = [];
  for (const l of [...p.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const [r] = await tx<ConsignPricingRow[]>`
      select si.product_id, p.name, p.code, p.unit, p.default_price, p.scheme as p_scheme, p.scheme_value as p_value,
             si.price as si_price, si.scheme as si_scheme, si.scheme_value as si_value, si.stock_qty,
             c.id as consignor_id, c.name as consignor_name, c.scheme as c_scheme, c.scheme_value as c_value
      from consign_stall_items si
      join consign_products p on p.id = si.product_id
      join consignors c on c.id = p.consignor_id
      where si.stall_id = ${p.stall.id} and si.product_id = ${l.productId} and p.is_active and c.is_active
    `;
    if (!r) throw new SaleError('Ada produk titipan yang tidak tersedia di lapak ini.');
    const pricing = pricingFromRow(r);
    if (!pricing.spec || !pricing.share) throw new SaleError(`${r.name}: skema bagi hasil belum ditentukan — tidak bisa dijual.`);
    if (pricing.share.ours < 0 || pricing.share.consignor < 0) throw new SaleError(`${r.name}: harga setor penitip lebih tinggi dari harga jual — perbaiki skema/harga produk ini dulu.`);
    await moveConsignStock(tx, {
      productId: l.productId, productName: r.name, stallId: p.stall.id, stallName: p.stall.name,
      delta: -l.qty, type: 'sale', receiptId: p.saleId, note: p.invoiceNo,
    });
    items.push({
      kind: 'consign', productId: l.productId, name: r.name, unit: r.unit, qty: l.qty, price: pricing.price, subtotal: pricing.price * l.qty,
      consignorId: r.consignor_id, consignorName: r.consignor_name, scheme: pricing.spec.scheme, schemeValue: pricing.spec.value,
      consignorShare: pricing.share.consignor, ourShare: pricing.share.ours,
    });
  }
  return items;
}

// Baris bagi hasil penjualan titipan (dasar rekap bayar ke penitip).
export async function insertConsignSaleLines(tx: Tx, p: { saleId: string; stallId: string; items: SaleItem[] }): Promise<void> {
  for (const i of p.items.filter(x => x.kind === 'consign')) {
    await tx`
      insert into consign_sale_lines (id, sale_id, stall_id, consignor_id, consignor_name, product_id, product_name, qty, price, scheme, scheme_value, consignor_amount, our_amount, created_at)
      values (${randomUUID()}, ${p.saleId}, ${p.stallId}, ${i.consignorId!}, ${i.consignorName!}, ${i.productId}, ${i.name}, ${i.qty}, ${i.price},
        ${i.scheme!}, ${i.schemeValue ?? 0}, ${(i.consignorShare ?? 0) * i.qty}, ${(i.ourShare ?? 0) * i.qty}, now())
    `;
  }
}

export async function getStoreStall(tx: Tx): Promise<StallRow> {
  const [stall] = await tx<StallRow[]>`select * from stalls where is_store`;
  if (!stall) throw new SaleError('Belum ada lapak bertanda Toko. Tandai satu lapak sebagai Toko di Titip Jual → Lapak.');
  if (!stall.is_active) throw new SaleError('Lapak Toko nonaktif.');
  return stall;
}

export interface StoreConsignLine { productId: string; qty: number }

// Bagian titipan dari satu keranjang Kasir toko: dicatat sebagai penjualan lapak Toko (tertaut ke pesanan
// toko lewat order_id), dibayar penuh saat itu juga, uangnya masuk dompet lapak Toko — bukan dompet toko.
export async function createStoreConsignSale(tx: Tx, p: {
  username: string; lines: StoreConsignLine[]; paymentMethod: 'cash' | 'transfer'; orderId: string | null; posShiftId: string | null;
  customerName: string; customerPhone: string; note: string;
}): Promise<{ saleId: string; invoiceNo: string; total: number; items: SaleItem[]; stall: { id: string; name: string } }> {
  const stall = await getStoreStall(tx);
  const prefix = stall.invoice_prefix ?? stall.code;
  if (!prefix) throw new SaleError('Lapak Toko belum punya awalan invoice.');
  const dateKey = wibDateKey(new Date());
  const saleId = randomUUID();
  const invoiceNo = await nextDocNumber(tx, prefix, periodOf(dateKey));
  const items = await sellConsignLines(tx, { stall, lines: p.lines, saleId, invoiceNo });
  const total = items.reduce((a, i) => a + i.subtotal, 0);
  await tx`
    insert into stall_sales (id, invoice_no, stall_id, stall_name, shift_id, date, cashier, items, subtotal, discount, total,
      payment_method, amount_paid, change_amount, note, customer_name, customer_phone, status, order_id, pos_shift_id, created_at)
    values (${saleId}, ${invoiceNo}, ${stall.id}, ${stall.name}, null, ${dateKey}, ${p.username}, ${tx.json(items as never)},
      ${total}, 0, ${total}, ${p.paymentMethod}, ${total}, 0, ${p.note}, ${p.customerName}, ${p.customerPhone}, 'paid', ${p.orderId}, ${p.posShiftId}, now())
  `;
  await insertConsignSaleLines(tx, { saleId, stallId: stall.id, items });
  if (total > 0) {
    await tx`
      insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
      values (${randomUUID()}, ${stall.id}, 'sale', ${total}, ${saleId}, ${invoiceNo}, ${p.username}, now())
    `;
  }
  return { saleId, invoiceNo, total, items, stall: { id: stall.id, name: stall.name } };
}

// Pesanan toko dibatalkan/dihapus → bagian titipannya ikut dibatalkan: stok titipan kembali, baris bagi hasil
// dibatalkan, uang keluar dari dompet lapak Toko. Ditolak kalau sudah masuk rekap penitip.
export async function voidStoreConsignSaleForOrder(tx: Tx, p: { orderId: string; username: string; reason: string }): Promise<boolean> {
  const [sale] = await tx<SaleRow[]>`select * from stall_sales where order_id = ${p.orderId} and status = 'paid' for update`;
  if (!sale) return false;
  const [settled] = await tx`select 1 from (select settlement_id from consign_sale_lines where sale_id = ${sale.id} for update) x where settlement_id is not null limit 1`;
  if (settled) throw new SaleError('Bagian titipan pesanan ini sudah masuk rekap penitip — batalkan rekapnya dulu.');
  const items = rowToSale(sale).items.filter(i => i.kind === 'consign');
  for (const i of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const back = i.qty - (i.returnedQty ?? 0);
    if (back > 0) {
      await moveConsignStock(tx, {
        productId: i.productId, productName: i.name, stallId: sale.stall_id, stallName: sale.stall_name,
        delta: back, type: 'void', receiptId: sale.id, note: `Batal ${sale.invoice_no}`,
      });
    }
  }
  await tx`update consign_sale_lines set voided = true where sale_id = ${sale.id}`;
  const net = Number(sale.total) - Number(sale.refund_total);
  if (net > 0) {
    await tx`
      insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
      values (${randomUUID()}, ${sale.stall_id}, 'sale', ${-net}, ${sale.id}, ${`Batal ${sale.invoice_no}`}, ${p.username}, now())
    `;
  }
  await tx`update stall_sales set status = 'void', void_reason = ${p.reason}, voided_by = ${p.username}, voided_at = now() where id = ${sale.id}`;
  return true;
}

export interface ConsignCatalogItem {
  kind: 'consign'; productId: string; name: string; code: string; unit: string; price: number; imageUrl: string; consignorId: string; weight: string;
  description: string; category: string; stock: number; consignorName: string; blocked: string;
}

// Katalog barang titipan satu lapak (harga & status skema dihitung di server).
export async function loadConsignCatalog(sql: ReturnType<typeof getSql>, stallId: string): Promise<ConsignCatalogItem[]> {
  const rows = await sql<(ConsignPricingRow & { image_url: string | null; weight: string; description: string; category_name: string | null })[]>`
    select si.product_id, p.name, p.code, p.unit, p.image_url, p.weight, p.description, cat.name as category_name, p.default_price, p.scheme as p_scheme, p.scheme_value as p_value,
           si.price as si_price, si.scheme as si_scheme, si.scheme_value as si_value, si.stock_qty,
           c.id as consignor_id, c.name as consignor_name, c.scheme as c_scheme, c.scheme_value as c_value
    from consign_stall_items si
    join consign_products p on p.id = si.product_id
    join consignors c on c.id = p.consignor_id
    left join categories cat on cat.id = p.category
    where si.stall_id = ${stallId} and p.is_active and c.is_active
    order by p.name
  `;
  return rows.map(r => {
    const pricing = pricingFromRow(r);
    return {
      kind: 'consign' as const, productId: r.product_id, name: r.name, code: r.code ?? '', unit: r.unit, price: pricing.price, imageUrl: r.image_url ?? '', consignorId: r.consignor_id,
      weight: r.weight, description: r.description, category: r.category_name ?? '', stock: Number(r.stock_qty), consignorName: r.consignor_name,
      // Tanpa skema bagi hasil, barang tidak boleh dijual (hutang ke penitip tak bisa dihitung).
      blocked: pricing.spec ? '' : 'Skema bagi hasil belum ditentukan',
    };
  });
}
