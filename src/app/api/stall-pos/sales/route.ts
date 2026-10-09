import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/db-retry';
import { wibDateKey } from '@/lib/date';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { guardStall, rowToSale, pricingFromRow, SaleError, type SaleRow, type SaleItem, type ConsignPricingRow } from '@/lib/stall-pos-server';
import { mergeSaleLines, discountProblem, paymentResult } from '@/lib/stall-pos';
import { moveConsignStock, ConsignStockError } from '@/lib/consign-receipts';
import { readProductsForDeltasPg, readWarehouseShortagesPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { auditConsign } from '@/lib/consign-audit';
import { getDb } from '@/lib/firebase-admin';
import { notifyProductLowStock } from '@/lib/low-stock';
import { notifyConsignLowStock } from '@/lib/low-stock-consign';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Riwayat penjualan lapak (terbaru dulu), difilter tanggal.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const guard = await guardStall(req, 'view', searchParams.get('stallId'));
  if (guard instanceof Response) return guard;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const sql = getSql();
  const rows = await sql<SaleRow[]>`
    select * from stall_sales
    where stall_id = ${guard.stall.id}
      ${from && DATE_RE.test(from) ? sql`and date >= ${from}` : sql``}
      ${to && DATE_RE.test(to) ? sql`and date <= ${to}` : sql``}
    order by created_at desc limit 300
  `;
  return Response.json({ sales: rows.map(rowToSale) });
}

// Buat penjualan lapak. Semua dihitung ulang di server (harga, bagi hasil, total) — angka dari
// klien tidak dipercaya. Stok barang titipan dan stok gudang produk toko berkurang atomik dalam
// satu transaksi dengan pencatatan penjualan, bagi hasil, dan masuknya uang ke dompet lapak.
export async function POST(req: NextRequest) {
  const data = await req.json() as Record<string, unknown>;
  const guard = await guardStall(req, 'create', typeof data.stallId === 'string' ? data.stallId : null);
  if (guard instanceof Response) return guard;
  const { user, stall } = guard;
  if (!stall.is_active) return Response.json({ error: 'Lapak nonaktif.' }, { status: 400 });
  const prefix = stall.invoice_prefix ?? stall.code;
  if (!prefix) return Response.json({ error: 'Lapak belum punya awalan invoice.' }, { status: 400 });

  const merged = mergeSaleLines(data.items);
  if ('error' in merged) return Response.json({ error: merged.error }, { status: 400 });
  const discountInput = data.discount === undefined || data.discount === '' ? 0 : Number(data.discount);
  const note = typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '';
  const customerName = typeof data.customerName === 'string' ? data.customerName.trim().slice(0, 80) : '';
  const customerPhone = typeof data.customerPhone === 'string' ? data.customerPhone.replace(/[^\d+\-\s]/g, '').trim().slice(0, 20) : '';

  const sql = getSql();
  const dateKey = wibDateKey(new Date());
  const saleId = randomUUID();

  try {
    const sale = await withDeadlockRetry(() => sql.begin(async tx => {
      const [shift] = await tx<{ id: string }[]>`select id from stall_shifts where stall_id = ${stall.id} and status = 'open'`;
      if (!shift) throw new SaleError('Kasir lapak belum dibuka. Buka kasir (shift) terlebih dahulu.');

      const invoiceNo = await nextDocNumber(tx, prefix, periodOf(dateKey));
      const items: SaleItem[] = [];

      // 1) Barang titipan — urut productId (urutan kunci seragam, hindari deadlock).
      const consignLines = merged.lines.filter(l => l.kind === 'consign').sort((a, b) => a.productId.localeCompare(b.productId));
      for (const l of consignLines) {
        const [r] = await tx<ConsignPricingRow[]>`
          select si.product_id, p.name, p.code, p.unit, p.default_price, p.scheme as p_scheme, p.scheme_value as p_value,
                 si.price as si_price, si.scheme as si_scheme, si.scheme_value as si_value, si.stock_qty,
                 c.id as consignor_id, c.name as consignor_name, c.scheme as c_scheme, c.scheme_value as c_value
          from consign_stall_items si
          join consign_products p on p.id = si.product_id
          join consignors c on c.id = p.consignor_id
          where si.stall_id = ${stall.id} and si.product_id = ${l.productId} and p.is_active and c.is_active
        `;
        if (!r) throw new SaleError('Ada produk titipan yang tidak tersedia di lapak ini.');
        const pricing = pricingFromRow(r);
        if (!pricing.spec || !pricing.share) throw new SaleError(`${r.name}: skema bagi hasil belum ditentukan — tidak bisa dijual.`);
        await moveConsignStock(tx, {
          productId: l.productId, productName: r.name, stallId: stall.id, stallName: stall.name,
          delta: -l.qty, type: 'sale', receiptId: saleId, note: invoiceNo,
        });
        items.push({
          kind: 'consign', productId: l.productId, name: r.name, unit: r.unit, qty: l.qty, price: pricing.price, subtotal: pricing.price * l.qty,
          consignorId: r.consignor_id, consignorName: r.consignor_name, scheme: pricing.spec.scheme, schemeValue: pricing.spec.value,
          consignorShare: pricing.share.consignor, ourShare: pricing.share.ours,
        });
      }

      // 2) Produk toko — stok dari gudang terkait lapak.
      const ownLines = merged.lines.filter(l => l.kind === 'own');
      if (ownLines.length > 0) {
        if (!stall.warehouse_id) throw new SaleError('Lapak ini belum punya gudang terkait — produk toko tidak bisa dijual di sini.');
        if (!stall.show_own_products) throw new SaleError('Lapak ini tidak diatur untuk menjual produk toko.');
        const deltas = new Map<string, number>(ownLines.map(l => [l.productId, -l.qty]));
        const { products, shortageDetails } = await readProductsForDeltasPg(tx, deltas);
        if (shortageDetails.length > 0) throw new SaleError(`Stok tidak cukup: ${shortageDetails.map(s => s.message).join(', ')}`);
        const names = new Map([...products].map(([pid, p]) => [pid, p.name]));
        const wsShort = await readWarehouseShortagesPg(tx, stall.warehouse_id, deltas, names);
        if (wsShort.length > 0) throw new SaleError(`Stok gudang lapak tidak cukup: ${wsShort.join(', ')}`);

        const priceRows = await tx<{ id: string; price: string | null; weight: string | null }[]>`select id, price, weight from products where id in ${tx([...deltas.keys()])}`;
        const priceById = new Map(priceRows.map(r => [r.id, r]));
        const [wh] = await tx<{ name: string }[]>`select name from warehouses where id = ${stall.warehouse_id}`;
        for (const [productId, delta] of [...deltas].sort(([a], [b]) => a.localeCompare(b))) {
          const product = products.get(productId)!;
          await applyStockDeltaPg(tx, { productId, product, warehouseId: stall.warehouse_id, delta });
          await writeStockLedgerEntryPg(tx, {
            productId, productName: product.name, warehouseId: stall.warehouse_id, warehouseName: wh?.name,
            type: 'out', qty: delta, note: `Penjualan Lapak ${stall.name} - ${invoiceNo}`,
          });
          const price = Number(priceById.get(productId)?.price ?? 0);
          const qty = -delta;
          items.push({ kind: 'own', productId, name: product.name, unit: priceById.get(productId)?.weight || 'pcs', qty, price, subtotal: price * qty, costPrice: product.costPrice });
        }
      }

      const subtotal = items.reduce((a, i) => a + i.subtotal, 0);
      // Diskon ditanggung toko: tidak boleh melebihi bagian toko (barang sendiri + bagian toko dari titipan).
      const maxDiscount = items.reduce((a, i) => a + (i.kind === 'own' ? i.subtotal : (i.ourShare ?? 0) * i.qty), 0);
      const dProblem = discountProblem(discountInput, maxDiscount);
      if (dProblem) throw new SaleError(dProblem);
      const total = subtotal - discountInput;
      const pay = paymentResult(data.paymentMethod, total, data.amountPaid);
      if ('error' in pay) throw new SaleError(pay.error);

      await tx`
        insert into stall_sales (id, invoice_no, stall_id, stall_name, shift_id, date, cashier, items, subtotal, discount, total,
          payment_method, amount_paid, change_amount, note, customer_name, customer_phone, status, created_at)
        values (${saleId}, ${invoiceNo}, ${stall.id}, ${stall.name}, ${shift.id}, ${dateKey}, ${user.username}, ${tx.json(items as never)},
          ${subtotal}, ${discountInput}, ${total}, ${pay.method}, ${pay.amountPaid}, ${pay.change}, ${note}, ${customerName}, ${customerPhone}, 'paid', now())
      `;
      for (const i of items.filter(x => x.kind === 'consign')) {
        await tx`
          insert into consign_sale_lines (id, sale_id, stall_id, consignor_id, consignor_name, product_id, product_name, qty, price, scheme, scheme_value, consignor_amount, our_amount, created_at)
          values (${randomUUID()}, ${saleId}, ${stall.id}, ${i.consignorId!}, ${i.consignorName!}, ${i.productId}, ${i.name}, ${i.qty}, ${i.price},
            ${i.scheme!}, ${i.schemeValue ?? 0}, ${(i.consignorShare ?? 0) * i.qty}, ${(i.ourShare ?? 0) * i.qty}, now())
        `;
      }
      // Uang masuk dompet lapak (semua metode bayar masuk ke satu dompet per lapak).
      if (total > 0) {
        await tx`
          insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
          values (${randomUUID()}, ${stall.id}, 'sale', ${total}, ${saleId}, ${invoiceNo}, ${user.username}, now())
        `;
      }
      const [row] = await tx<SaleRow[]>`select * from stall_sales where id = ${saleId}`;
      return row;
    }));
    const result = rowToSale(sale);
    await auditConsign(user, 'create', 'stall-sales', saleId, `Penjualan lapak ${result.invoiceNo}`, null, { total: result.total, stall: stall.name, items: result.items.length });
    // Pengingat stok menipis (tanpa cron): hanya saat stok BARU melewati batas minimum; best-effort.
    const db = getDb();
    const source = `penjualan lapak ${stall.name}`;
    const soldConsign = new Map(merged.lines.filter(l => l.kind === 'consign').map(l => [l.productId, l.qty]));
    const ownDeltas = new Map(merged.lines.filter(l => l.kind === 'own').map(l => [l.productId, -l.qty]));
    await notifyConsignLowStock(db, { id: stall.id, name: stall.name }, soldConsign, user, source);
    await notifyProductLowStock(db, ownDeltas, user, source);
    return Response.json({ sale: result });
  } catch (err) {
    if (err instanceof SaleError || err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
