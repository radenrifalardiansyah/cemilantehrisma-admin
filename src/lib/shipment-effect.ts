import type postgres from 'postgres';
import { ShipmentActionError } from '@/lib/shipment-status';
import { writeStockLedgerEntryPg, stockLabel, captureAndSetWs, readWarehouseShortagesPg, type WsSnapshot } from '@/lib/stock-pg';

// Efek stok sebuah Kirim Stok yang BERSTATUS APPROVED — satu-satunya tempat logikanya hidup, dipakai oleh
// approve (draft → approved), edit approved (balik efek lama + terapkan efek baru), dan hapus approved
// (balik efek). Draft/ditolak tidak pernah memanggil ini.
//
// WAJIB dipanggil di dalam `sql.begin(async pgTx => ...)` milik caller (tidak membuka transaksi sendiri).
// Urutan kunci SERAGAM: baris shipment (oleh caller) → produk → stok gudang → stok titip (lihat
// warehouse-stock.ts); id selalu terurut. Caller yang memanggil reverse lalu apply dalam satu transaksi
// (edit) sebaiknya memanggil lockShipmentRows dulu dengan gabungan id lama+baru.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/stock-pg.ts
type PgTx = postgres.ISql<{}>;

export interface ShipmentEffectItem { productId: string; productName: string; qty: number; hargaTitip: number }
export interface ShipmentEffectInput {
  locationId: string;
  locationName: string;
  warehouseId?: string | null;
  warehouseName?: string | null;
  note?: string | null;
  items: ShipmentEffectItem[];
}

interface ProductLockRow { id: string; stock_qty: string; open_po: boolean }
interface StockLockRow { id: string; stock_qty: string; harga_titip: string | null }

export const stockKeyOf = (locationId: string, productId: string) => `${locationId}_${productId}`;

// Kunci produk → stok gudang → stok titip (urut id). Aman dipanggil berulang untuk baris yang sudah terkunci.
export async function lockShipmentRows(
  pgTx: PgTx,
  o: { productIds: string[]; warehouseId?: string | null | (string | null | undefined)[]; stockKeys: string[] },
) {
  const productIds = [...new Set(o.productIds)];
  const stockKeys = [...new Set(o.stockKeys)];
  const productRows = productIds.length > 0
    ? await pgTx<ProductLockRow[]>`select id, stock_qty, open_po from products where id in ${pgTx(productIds)} order by id for update`
    : [];
  const warehouseIds = [...new Set((Array.isArray(o.warehouseId) ? o.warehouseId : [o.warehouseId]).filter((w): w is string => !!w))];
  if (warehouseIds.length > 0 && productIds.length > 0) {
    const wsKeys = warehouseIds.flatMap(w => productIds.map(pid => `${w}_${pid}`));
    await pgTx`select id from warehouse_stock where id in ${pgTx(wsKeys)} order by id for update`;
  }
  const stockRows = stockKeys.length > 0
    ? await pgTx<StockLockRow[]>`select id, stock_qty, harga_titip from consignment_stock where id in ${pgTx(stockKeys)} order by id for update`
    : [];
  return {
    productById: new Map(productRows.map(r => [r.id, r])),
    stockById: new Map(stockRows.map(r => [r.id, r])),
  };
}

// Terapkan efek kirim: kurangi stok toko & stok gudang asal, ledger 'out', tambah stok titip di lokasi
// dengan harga titip rata-rata tertimbang. Melempar Error (pesan siap tampil) bila stok tidak cukup.
export async function applyShipmentEffect(pgTx: PgTx, s: ShipmentEffectInput, opts: { edited?: boolean } = {}): Promise<void> {
  const { items } = s;
  if (!s.warehouseId) throw new ShipmentActionError('Pilih gudang asal pengiriman.');
  const productIds = items.map(it => it.productId);
  const stockKeys = items.map(it => stockKeyOf(s.locationId, it.productId));
  const { productById, stockById } = await lockShipmentRows(pgTx, { productIds, warehouseId: s.warehouseId, stockKeys });

  // Qty digabung per produk supaya baris ganda untuk produk yang sama ikut terhitung di validasi.
  const qtyByProduct = new Map<string, number>();
  const nameByProduct = new Map<string, string>();
  for (const it of items) {
    qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + it.qty);
    if (!nameByProduct.has(it.productId)) nameByProduct.set(it.productId, it.productName);
  }

  const shortages: string[] = [];
  qtyByProduct.forEach((qty, pid) => {
    const row = productById.get(pid);
    const name = nameByProduct.get(pid) ?? pid;
    if (!row) { shortages.push(`${name} (produk tidak ditemukan)`); return; }
    const stockQty = Number(row.stock_qty) || 0;
    if (stockQty < qty) shortages.push(`${name} (stok toko ${stockQty}, butuh ${qty})`);
  });
  if (shortages.length > 0) throw new ShipmentActionError(`Stok produk tidak cukup untuk dikirim: ${shortages.join(', ')}`);

  const wsDeltas = new Map<string, number>();
  qtyByProduct.forEach((qty, pid) => wsDeltas.set(pid, -qty));
  const wsShortages = await readWarehouseShortagesPg(pgTx, s.warehouseId, wsDeltas, nameByProduct);
  if (wsShortages.length > 0) throw new ShipmentActionError(`Stok gudang asal tidak cukup untuk dikirim: ${wsShortages.join(', ')}`);

  const curProductQty = new Map([...productById].map(([id, r]) => [id, Number(r.stock_qty) || 0]));
  const curStock = new Map([...stockById].map(([id, r]) => [id, { qty: Number(r.stock_qty) || 0, harga: r.harga_titip != null ? Number(r.harga_titip) : 0 }]));
  const wsSnapshots: WsSnapshot[] = [];
  const ledgerLabel = opts.edited ? 'Kirim konsinyasi (diedit)' : 'Kirim konsinyasi';

  for (const [i, it] of items.entries()) {
    const row = productById.get(it.productId)!;
    const newQty = (curProductQty.get(it.productId) ?? 0) - it.qty;
    curProductQty.set(it.productId, newQty);
    await pgTx`update products set stock_qty = ${newQty}, stock = ${stockLabel(row.open_po, newQty)}, updated_at = now() where id = ${it.productId}`;

    await captureAndSetWs(pgTx, wsSnapshots, `${s.warehouseId}_${it.productId}`, s.warehouseId, it.productId, it.productName, old => old - it.qty);
    await writeStockLedgerEntryPg(pgTx, {
      productId: it.productId, productName: it.productName, warehouseId: s.warehouseId, warehouseName: s.warehouseName ?? undefined,
      type: 'out', qty: it.qty, note: `${ledgerLabel} – ${s.locationName}${s.note ? `: ${s.note}` : ''}`,
    });

    const key = stockKeys[i];
    const cur = curStock.get(key) ?? { qty: 0, harga: 0 };
    const newStockQty = cur.qty + it.qty;
    const newHarga = newStockQty > 0 ? (cur.qty * cur.harga + it.qty * it.hargaTitip) / newStockQty : 0;
    curStock.set(key, { qty: newStockQty, harga: newHarga });
    await pgTx`
      insert into consignment_stock (id, location_id, product_id, product_name, stock_qty, harga_titip, updated_at)
      values (${key}, ${s.locationId}, ${it.productId}, ${it.productName}, ${newStockQty}, ${newHarga}, now())
      on conflict (id) do update set stock_qty = ${newStockQty}, harga_titip = ${newHarga}, updated_at = now()
    `;
  }
}

// Balik efek kirim (edit/hapus shipment approved): stok toko & stok gudang asal kembali, stok titip
// berkurang, ledger 'in'. Ditolak bila stok titip sudah terpakai (terjual/direkap) sehingga tak cukup
// untuk dibalik. Kiriman lama tanpa warehouse_id tidak pernah memotong gudang → gudang tidak dibalik.
export async function reverseShipmentEffect(pgTx: PgTx, s: ShipmentEffectInput, opts: { context: 'edit' | 'delete' }): Promise<void> {
  const { items } = s;
  const productIds = items.map(it => it.productId);
  const stockKeys = items.map(it => stockKeyOf(s.locationId, it.productId));
  const { productById, stockById } = await lockShipmentRows(pgTx, { productIds, warehouseId: s.warehouseId, stockKeys });

  const curStock = new Map([...stockById].map(([id, r]) => [id, Number(r.stock_qty) || 0]));
  const shortages: string[] = [];
  items.forEach((it, i) => {
    const key = stockKeys[i];
    const cur = curStock.get(key) ?? 0;
    if (cur < it.qty) shortages.push(`${it.productName} (stok titip tersisa ${cur}, butuh ${it.qty})`);
    curStock.set(key, cur - it.qty);
  });
  if (shortages.length > 0) {
    throw new ShipmentActionError(opts.context === 'delete'
      ? `Tidak bisa menghapus — sebagian stok kiriman ini sudah terjual/direkap: ${shortages.join(', ')}`
      : `Tidak bisa mengubah — sebagian stok kiriman lama sudah terjual/direkap: ${shortages.join(', ')}`);
  }

  const curProductQty = new Map([...productById].map(([id, r]) => [id, Number(r.stock_qty) || 0]));
  const ledgerNote = opts.context === 'delete'
    ? `Hapus kirim konsinyasi – ${s.locationName ?? ''}`
    : `Edit kirim konsinyasi (kiriman lama dibatalkan) – ${s.locationName ?? ''}`;

  for (const [i, it] of items.entries()) {
    const productRow = productById.get(it.productId);
    if (productRow) {
      const newQty = (curProductQty.get(it.productId) ?? 0) + it.qty;
      curProductQty.set(it.productId, newQty);
      await pgTx`update products set stock_qty = ${newQty}, stock = ${stockLabel(productRow.open_po, newQty)}, updated_at = now() where id = ${it.productId}`;
    }
    const key = stockKeys[i];
    await pgTx`update consignment_stock set stock_qty = ${curStock.get(key) ?? 0}, updated_at = now() where id = ${key}`;
    // (curStock sudah memuat hasil pengurangan seluruh baris duplikat; update berulang menulis nilai akhir yang sama)

    if (s.warehouseId) {
      const wsKey = `${s.warehouseId}_${it.productId}`;
      const wsRows = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${wsKey} for update`;
      const oldWsQty = wsRows[0] ? Number(wsRows[0].stock_qty) || 0 : 0;
      await pgTx`
        insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
        values (${wsKey}, ${s.warehouseId}, ${it.productId}, ${it.productName}, ${oldWsQty + it.qty}, now())
        on conflict (id) do update set stock_qty = ${oldWsQty + it.qty}, updated_at = now()
      `;
      await writeStockLedgerEntryPg(pgTx, {
        productId: it.productId, productName: it.productName, warehouseId: s.warehouseId, warehouseName: s.warehouseName ?? undefined,
        type: 'in', qty: it.qty, note: ledgerNote,
      });
    }
  }
}

// Perubahan stok toko bertanda per produk (negatif = keluar) untuk notifyProductLowStock.
export function shipmentStockDeltas(items: { productId: string; qty: number }[], sign: 1 | -1 = -1): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.productId, (m.get(it.productId) ?? 0) + sign * it.qty);
  return m;
}
