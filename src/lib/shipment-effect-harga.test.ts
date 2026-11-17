import { describe, expect, it, vi } from 'vitest';
import * as eff from './shipment-effect';
import type { ShipmentEffectInput } from './shipment-effect';

// Tes rata-rata harga titip (consignment_stock.harga_titip) lewat apply/reverse dengan DB palsu in-memory.
// Yang diuji: reverse harus mengeluarkan kontribusi harga kiriman dari rata-rata (bug: harga lama tertinggal).

vi.mock('@/lib/stock-pg', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/stock-pg')>()),
  writeStockLedgerEntryPg: vi.fn(async () => {}),
  captureAndSetWs: vi.fn(async () => {}),
  readWarehouseShortagesPg: vi.fn(async () => []),
}));

interface Db { products: Map<string, number>; cs: Map<string, { qty: number; harga: number }>; shipments: Map<string, ShipmentEffectInput> }
type Tx = Parameters<typeof eff.applyShipmentEffect>[0];

// Pembungkus: kiriman yang di-apply tercatat sebagai 'approved' di tabel palsu (dibaca reverse untuk
// rentang harga kiriman lain), dan dilepas lagi saat di-reverse — meniru edit/hapus di route.
const dbOf = new WeakMap<object, Db>();
let seq = 0;
const applyShipmentEffect = async (tx: Tx, s: ShipmentEffectInput, o?: { edited?: boolean }) => {
  const r = await eff.applyShipmentEffect(tx, s, o);
  dbOf.get(tx)!.shipments.set(s.id ?? (s.id = `S${++seq}`), s);
  return r;
};
const reverseShipmentEffect = async (tx: Tx, s: ShipmentEffectInput, o: { context: 'edit' | 'delete' }) => {
  await eff.reverseShipmentEffect(tx, s, o);
  if (s.id) dbOf.get(tx)!.shipments.delete(s.id);
};

function fakeTx(db: Db) {
  const fn = ((strings: TemplateStringsArray | unknown, ...v: unknown[]) => {
    if (!(strings as { raw?: unknown }).raw) return strings; // pgTx(array) → fragmen `in`
    const t = (strings as unknown as string[]).join('?').replace(/\s+/g, ' ').trim();
    if (t.startsWith('select id, stock_qty, open_po from products')) {
      return Promise.resolve([...db.products].map(([id, q]) => ({ id, stock_qty: String(q), open_po: false })));
    }
    if (t.startsWith('select items from consignment_shipments')) {
      const excl = v[1] as string;
      return Promise.resolve([...db.shipments].filter(([id, sh]) => id !== excl && sh.locationId === v[0]).map(([, sh]) => ({ items: sh.items })));
    }
    if (t.startsWith('select id from warehouse_stock')) return Promise.resolve([]);
    if (t.startsWith('select stock_qty from warehouse_stock')) return Promise.resolve([{ stock_qty: '1000' }]);
    if (t.startsWith('select id, stock_qty, harga_titip from consignment_stock')) {
      const keys = v[0] as string[];
      return Promise.resolve(keys.filter(k => db.cs.has(k)).map(k => ({ id: k, stock_qty: String(db.cs.get(k)!.qty), harga_titip: String(db.cs.get(k)!.harga) })));
    }
    if (t.startsWith('update products set')) { db.products.set(v[2] as string, v[0] as number); return Promise.resolve([]); }
    if (t.startsWith('insert into warehouse_stock')) return Promise.resolve([]);
    if (t.startsWith('insert into consignment_stock')) {
      // values: key, locationId, productId, productName, newStockQty, newHarga ; on conflict set qty, harga
      db.cs.set(v[0] as string, { qty: v[4] as number, harga: v[5] as number });
      return Promise.resolve([]);
    }
    if (t.startsWith('update consignment_stock set')) {
      // values: qty, [harga,] key — tanpa harga (perilaku lama) harga yang tersimpan dibiarkan
      const key = v[v.length - 1] as string;
      db.cs.set(key, { qty: v[0] as number, harga: v.length === 3 ? (v[1] as number) : db.cs.get(key)?.harga ?? 0 });
      return Promise.resolve([]);
    }
    throw new Error(`SQL tak dikenal: ${t}`);
  }) as unknown as Parameters<typeof applyShipmentEffect>[0];
  dbOf.set(fn, db);
  return fn;
}

let shipSeq = 0;
const ship = (items: { qty: number; hargaTitip: number }[]): ShipmentEffectInput => ({
  id: `T${++shipSeq}`, locationId: 'L1', locationName: 'Warung', warehouseId: 'W1', warehouseName: 'Gudang',
  items: items.map(i => ({ productId: 'P1', productName: 'Teh', ...i })),
});
const newDb = (stock?: { qty: number; harga: number }): Db => ({ products: new Map([['P1', 1000]]), cs: new Map(stock ? [['L1_P1', stock]] : []), shipments: new Map() });
const row = (db: Db) => db.cs.get('L1_P1')!;

describe('harga titip rata-rata: reverse mengeluarkan kontribusi harga', () => {
  it('edit harga: stok awal 1 @9000, kiriman 3 @900 diedit jadi @9000 → harga akhir tepat 9000', async () => {
    const db = newDb({ qty: 1, harga: 9000 });
    const tx = fakeTx(db);
    const lama = ship([{ qty: 3, hargaTitip: 900 }]);
    await applyShipmentEffect(tx, lama);
    expect(row(db)).toEqual({ qty: 4, harga: 2925 });
    await reverseShipmentEffect(tx, lama, { context: 'edit' });
    expect(row(db)).toEqual({ qty: 1, harga: 9000 });
    await applyShipmentEffect(tx, ship([{ qty: 3, hargaTitip: 9000 }]), { edited: true });
    expect(row(db)).toEqual({ qty: 4, harga: 9000 });
  });

  it('hapus kiriman dengan stok sisa: rata-rata kembali ke harga stok yang tersisa', async () => {
    const db = newDb({ qty: 5, harga: 8000 });
    const tx = fakeTx(db);
    const k = ship([{ qty: 2, hargaTitip: 1000 }]);
    await applyShipmentEffect(tx, k);
    await reverseShipmentEffect(tx, k, { context: 'delete' });
    expect(row(db)).toEqual({ qty: 5, harga: 8000 });
  });

  it('hapus kiriman yang menghabiskan stok: harga reset ke 0', async () => {
    const db = newDb();
    const tx = fakeTx(db);
    const k = ship([{ qty: 3, hargaTitip: 900 }]);
    await applyShipmentEffect(tx, k);
    await reverseShipmentEffect(tx, k, { context: 'delete' });
    expect(row(db)).toEqual({ qty: 0, harga: 0 });
    expect(Object.is(row(db).harga, -0)).toBe(false);
  });

  it('dua kiriman beda harga lalu hapus salah satu: kembali ke harga kiriman tersisa', async () => {
    const db = newDb();
    const tx = fakeTx(db);
    const a = ship([{ qty: 4, hargaTitip: 1000 }]);
    const b = ship([{ qty: 6, hargaTitip: 2000 }]);
    await applyShipmentEffect(tx, a);
    await applyShipmentEffect(tx, b);
    expect(row(db).harga).toBeCloseTo(1600, 6);
    await reverseShipmentEffect(tx, b, { context: 'delete' });
    expect(row(db)).toEqual({ qty: 4, harga: 1000 });
    const db2 = newDb();
    const tx2 = fakeTx(db2);
    await applyShipmentEffect(tx2, a); await applyShipmentEffect(tx2, b);
    await reverseShipmentEffect(tx2, a, { context: 'delete' });
    expect(row(db2)).toEqual({ qty: 6, harga: 2000 });
  });

  it('baris duplikat produk yang sama dalam satu kiriman', async () => {
    const db = newDb({ qty: 2, harga: 5000 });
    const tx = fakeTx(db);
    const k = ship([{ qty: 3, hargaTitip: 900 }, { qty: 1, hargaTitip: 1500 }]);
    await applyShipmentEffect(tx, k);
    expect(row(db).qty).toBe(6);
    await reverseShipmentEffect(tx, k, { context: 'delete' });
    expect(row(db)).toEqual({ qty: 2, harga: 5000 });
  });

  it('baris duplikat yang menghabiskan stok → harga 0', async () => {
    const db = newDb();
    const tx = fakeTx(db);
    const k = ship([{ qty: 3, hargaTitip: 900 }, { qty: 2, hargaTitip: 1500 }]);
    await applyShipmentEffect(tx, k);
    await reverseShipmentEffect(tx, k, { context: 'delete' });
    expect(row(db)).toEqual({ qty: 0, harga: 0 });
  });

  it('item lama tanpa hargaTitip (undefined) tidak menghasilkan NaN', async () => {
    const db = newDb({ qty: 4, harga: 1000 });
    const tx = fakeTx(db);
    const k = ship([{ qty: 2, hargaTitip: undefined as unknown as number }]);
    await reverseShipmentEffect(tx, k, { context: 'delete' });
    expect(Number.isFinite(row(db).harga)).toBe(true);
    expect(row(db).qty).toBe(2);
  });

  it('validasi stok tak cukup tetap menolak dan tidak mengubah apa pun', async () => {
    const db = newDb({ qty: 1, harga: 1000 });
    await expect(reverseShipmentEffect(fakeTx(db), ship([{ qty: 3, hargaTitip: 1000 }]), { context: 'delete' })).rejects.toThrow(/sudah terjual/);
    expect(row(db)).toEqual({ qty: 1, harga: 1000 });
  });
});

// Syahla: tes properti/skenario tambahan. Invarian yang dipakai tak bergantung pada aturan FIFO/rata-rata
// untuk stok terjual: setelah sebuah kiriman dibalik, harga rata-rata sisa HARUS berada di antara harga
// terendah dan tertinggi kiriman LAIN yang masih membentuk stok (rata-rata tertimbang tak mungkin di luar rentang).
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

describe('reverse setelah sebagian stok terjual (rekap tidak mengubah harga rata-rata)', () => {
  it('A 10@1000, B 10@2000, terjual 5, hapus B → harga sisa tak boleh di luar rentang harga kiriman lain (1000)', async () => {
    const db = newDb();
    const tx = fakeTx(db);
    const a = ship([{ qty: 10, hargaTitip: 1000 }]);
    const b = ship([{ qty: 10, hargaTitip: 2000 }]);
    await applyShipmentEffect(tx, a); await applyShipmentEffect(tx, b);
    row(db).qty -= 5; // rekap menjual 5 (harga_titip tidak berubah)
    await reverseShipmentEffect(tx, b, { context: 'delete' });
    expect(row(db).qty).toBe(5);
    // Hanya kiriman A yang tersisa dalam sistem → harga semestinya 1000.
    expect(row(db).harga).toBeGreaterThanOrEqual(1000);
    expect(row(db).harga).toBeLessThanOrEqual(1000);
  });

  it('property: harga hasil reverse selalu di dalam [min,max] harga kiriman lain, tak NaN/negatif/-0', async () => {
    const bad: string[] = [];
    const r = rng(12345);
    for (let n = 0; n < 400; n++) {
      const db = newDb();
      const tx = fakeTx(db);
      const ships: ShipmentEffectInput[] = [];
      const k = 2 + Math.floor(r() * 3);
      for (let i = 0; i < k; i++) {
        const s = ship([{ qty: 1 + Math.floor(r() * 20), hargaTitip: 100 * (1 + Math.floor(r() * 50)) }]);
        ships.push(s); await applyShipmentEffect(tx, s);
        if (r() < 0.5 && row(db).qty > 1) row(db).qty -= 1 + Math.floor(r() * (row(db).qty - 1)); // jual
      }
      const idx = Math.floor(r() * k);
      const target = ships[idx];
      const others = ships.filter((_, i) => i !== idx).map(s => s.items[0].hargaTitip);
      const before = { ...row(db) };
      try { await reverseShipmentEffect(tx, target, { context: 'delete' }); } catch { continue; }
      const after = row(db);
      const lo = Math.min(...others), hi = Math.max(...others);
      if (!Number.isFinite(after.harga) || Object.is(after.harga, -0) || (after.qty > 0 && (after.harga < lo - 1e-6 || after.harga > hi + 1e-6))) {
        bad.push(`n=${n} before=${JSON.stringify(before)} hapus qty=${target.items[0].qty}@${target.items[0].hargaTitip} lain=[${others}] → ${JSON.stringify(after)}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(bad.length).toBe(0);
  });
});

describe('reverse: kasus numerik', () => {
  it('sisa pecahan sangat kecil (qty 3.000001, reverse 3) tidak meledak/NaN', async () => {
    const db = newDb({ qty: 3.000001, harga: 1000 });
    await reverseShipmentEffect(fakeTx(db), ship([{ qty: 3, hargaTitip: 900 }]), { context: 'delete' });
    expect(Number.isFinite(row(db).harga)).toBe(true);
    expect(row(db).harga).toBeGreaterThanOrEqual(0);
  });

  it('hargaTitip item negatif/NaN tidak membuat harga NaN', async () => {
    const db = newDb({ qty: 4, harga: 1000 });
    await reverseShipmentEffect(fakeTx(db), ship([{ qty: 2, hargaTitip: NaN }]), { context: 'delete' });
    expect(Number.isFinite(row(db).harga)).toBe(true);
  });

  it('harga_titip null di DB dengan sisa >0 → 0, bukan NaN', async () => {
    const db = newDb({ qty: 4, harga: 0 });
    await reverseShipmentEffect(fakeTx(db), ship([{ qty: 2, hargaTitip: 500 }]), { context: 'delete' });
    expect(row(db).harga).toBe(0);
  });

  it('edit qty kiriman tunggal: 5@1000 jadi 8@1000, harga tetap 1000 persis', async () => {
    const db = newDb();
    const tx = fakeTx(db);
    const lama = ship([{ qty: 5, hargaTitip: 1000 }]);
    await applyShipmentEffect(tx, lama);
    await reverseShipmentEffect(tx, lama, { context: 'edit' });
    await applyShipmentEffect(tx, ship([{ qty: 8, hargaTitip: 1000 }]), { edited: true });
    expect(row(db)).toEqual({ qty: 8, harga: 1000 });
  });

  it('harga pecahan (1/3) bolak-balik 50x tidak melenceng > 1e-3', async () => {
    const db = newDb({ qty: 7, harga: 1234.5678 });
    const tx = fakeTx(db);
    const k = ship([{ qty: 3, hargaTitip: 3333.3333 }]);
    for (let i = 0; i < 50; i++) { await applyShipmentEffect(tx, k); await reverseShipmentEffect(tx, k, { context: 'edit' }); }
    expect(Math.abs(row(db).harga - 1234.5678)).toBeLessThan(1e-3);
  });
});
