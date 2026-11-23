import type postgres from 'postgres';
import { TransferActionError } from '@/lib/consignment-transfer-status';
import { stockKeyOf, weightedPriceAfterAdd, priceAfterRemoval, loadInboundPriceRanges } from '@/lib/shipment-effect';

// Efek stok Transfer Stok Antar Mitra yang BERSTATUS APPROVED — satu-satunya tempat logikanya hidup, dipakai
// approve (apply) dan cancel (reverse). Hanya consignment_stock yang berubah: products.stock_qty dan
// warehouse_stock TIDAK disentuh (barang pindah antar mitra tanpa lewat gudang/toko).
//
// WAJIB dipanggil di dalam `sql.begin(async pgTx => ...)` milik caller (tidak membuka transaksi sendiri), setelah
// caller mengunci baris transfer. Semua baris stok KEDUA lokasi dikunci dengan SATU query `order by id for update`,
// jadi dua transfer berlawanan (A->B dan B->A) mengunci dalam urutan id yang sama: tidak bisa deadlock satu sama lain.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/stock-pg.ts
type PgTx = postgres.ISql<{}>;

export interface TransferEffectItem { productId: string; productName: string; qty: number; hargaTitip: number }
export interface TransferEffectInput {
  id: string;
  fromLocationId: string; fromLocationName: string;
  toLocationId: string; toLocationName: string;
  items: TransferEffectItem[];
}

interface StockLockRow { id: string; stock_qty: string; harga_titip: string | null }
type StockState = { qty: number; harga: number };

// Gabungkan baris per produk (qty dijumlah; nama & harga snapshot dari baris pertama).
function mergeByProduct(items: TransferEffectItem[]): TransferEffectItem[] {
  const m = new Map<string, TransferEffectItem>();
  for (const it of items) {
    const ex = m.get(it.productId);
    if (ex) ex.qty += it.qty; else m.set(it.productId, { ...it });
  }
  return [...m.values()];
}

// Kunci baris stok kedua lokasi untuk semua produk dalam SATU query terurut.
async function lockStockRows(pgTx: PgTx, t: TransferEffectInput, productIds: string[]): Promise<Map<string, StockState>> {
  const keys = [...new Set(productIds.flatMap(pid => [stockKeyOf(t.fromLocationId, pid), stockKeyOf(t.toLocationId, pid)]))];
  const rows = await pgTx<StockLockRow[]>`select id, stock_qty, harga_titip from consignment_stock where id in ${pgTx(keys)} order by id for update`;
  return new Map(rows.map(r => [r.id, { qty: Number(r.stock_qty) || 0, harga: r.harga_titip != null ? Number(r.harga_titip) || 0 : 0 }]));
}

async function writeStock(pgTx: PgTx, locationId: string, it: TransferEffectItem, qty: number, harga: number) {
  const key = stockKeyOf(locationId, it.productId);
  await pgTx`
    insert into consignment_stock (id, location_id, product_id, product_name, stock_qty, harga_titip, updated_at)
    values (${key}, ${locationId}, ${it.productId}, ${it.productName}, ${qty}, ${harga}, now())
    on conflict (id) do update set stock_qty = ${qty}, harga_titip = ${harga}, updated_at = now()
  `;
}

// Approve: stok A dikurangi (harga A tidak berubah); stok B ditambah dengan harga rata-rata tertimbang
// memakai p = harga titip A SAAT APPROVE. Mengembalikan items dengan hargaTitip snapshot (p) untuk disimpan.
// Melempar TransferActionError (pesan siap tampil) bila stok A tidak cukup.
export async function applyTransferEffect(pgTx: PgTx, t: TransferEffectInput): Promise<TransferEffectItem[]> {
  const items = mergeByProduct(t.items);
  const stock = await lockStockRows(pgTx, t, items.map(it => it.productId));

  const shortages: string[] = [];
  for (const it of items) {
    const a = stock.get(stockKeyOf(t.fromLocationId, it.productId));
    if (!a) shortages.push(`${it.productName} (tidak ada stok di ${t.fromLocationName}, butuh ${it.qty})`);
    else if (a.qty < it.qty) shortages.push(`${it.productName} (stok di ${t.fromLocationName} ${a.qty}, butuh ${it.qty})`);
  }
  if (shortages.length > 0) throw new TransferActionError(`Stok mitra asal tidak cukup untuk dipindahkan: ${shortages.join(', ')}`);

  const snapshot: TransferEffectItem[] = [];
  for (const it of items) {
    const a = stock.get(stockKeyOf(t.fromLocationId, it.productId))!;
    const b = stock.get(stockKeyOf(t.toLocationId, it.productId)) ?? { qty: 0, harga: 0 };
    const p = a.harga;
    await writeStock(pgTx, t.fromLocationId, it, a.qty - it.qty, a.harga);
    await writeStock(pgTx, t.toLocationId, it, b.qty + it.qty, weightedPriceAfterAdd(b.qty, b.harga, it.qty, p));
    snapshot.push({ ...it, hargaTitip: p });
  }
  return snapshot;
}

// Cancel (approved -> dibatalkan): balik efek. A ditambah qty dengan harga snapshot (rata-rata tertimbang); B
// dikurangi qty dengan kontribusi harganya dikeluarkan (dijepit ke rentang harga masuk lain di B). Ditolak
// (TransferActionError) bila stok B sekarang < qty (sebagian sudah terjual/direkap atau dipindah lagi).
export async function reverseTransferEffect(pgTx: PgTx, t: TransferEffectInput): Promise<void> {
  const items = mergeByProduct(t.items);
  const productIds = items.map(it => it.productId);
  const stock = await lockStockRows(pgTx, t, productIds);

  const shortages: string[] = [];
  for (const it of items) {
    const b = stock.get(stockKeyOf(t.toLocationId, it.productId)) ?? { qty: 0, harga: 0 };
    if (b.qty < it.qty) shortages.push(`${it.productName} (stok di ${t.toLocationName} tersisa ${b.qty}, butuh ${it.qty})`);
  }
  if (shortages.length > 0) {
    throw new TransferActionError(`Tidak bisa membatalkan — sebagian stok transfer ini mungkin sudah terjual/direkap atau dipindah lagi dari ${t.toLocationName}: ${shortages.join(', ')}`);
  }

  const others = await loadInboundPriceRanges(pgTx, { locationId: t.toLocationId, productIds, excludeTransferId: t.id });
  for (const it of items) {
    const p = Number(it.hargaTitip) || 0;
    const a = stock.get(stockKeyOf(t.fromLocationId, it.productId)) ?? { qty: 0, harga: 0 };
    const b = stock.get(stockKeyOf(t.toLocationId, it.productId))!;
    await writeStock(pgTx, t.fromLocationId, it, a.qty + it.qty, weightedPriceAfterAdd(a.qty, a.harga, it.qty, p));
    await writeStock(pgTx, t.toLocationId, it, b.qty - it.qty, priceAfterRemoval(b, it.qty, p, others.get(stockKeyOf(t.toLocationId, it.productId))));
  }
}
