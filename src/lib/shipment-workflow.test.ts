import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes perilaku approve/tolak/efek stok Kirim Stok memakai "Postgres" palsu di memori: transaksi
// (sql.begin) menyalin state dan mengembalikannya saat melempar error, jadi rollback ikut teruji.
// Query yang tak dikenal sengaja melempar error — mis. draft/ditolak tidak boleh menyentuh tabel stok.
// BUKAN pengganti uji terhadap Postgres sungguhan (penguncian baris/deadlock tidak ditiru).

interface FakeState {
  shipment: Record<string, unknown> | null;
  products: Record<string, { stock_qty: number; open_po: boolean }>;
  ws: Record<string, number>;
  cs: Record<string, { qty: number; harga: number | null }>;
  ledger: { productId: string; warehouseId: string | null; type: string; qty: number; note: string }[];
  queries: string[];
}

const h = vi.hoisted(() => ({ state: null as unknown as FakeState }));

class Helper { constructor(public ids: unknown[]) {} }

function exec(s: FakeState, text: string, v: unknown[]): unknown[] {
  s.queries.push(text);
  const idsOf = (x: unknown) => (x as Helper).ids as string[];
  if (text.includes('from consignment_shipments where id = ? for update')) {
    return s.shipment && s.shipment.id === v[0] ? [{ ...s.shipment }] : [];
  }
  if (text.startsWith("update consignment_shipments set status = 'approved'")) {
    s.shipment = { ...s.shipment!, status: 'approved', approved_by: v[0] };
    return [];
  }
  if (text.startsWith("update consignment_shipments set status = 'ditolak'")) {
    s.shipment = { ...s.shipment!, status: 'ditolak', rejected_by: v[0], reject_reason: v[1] };
    return [];
  }
  if (text.includes('from products where id in')) {
    return idsOf(v[0]).filter(id => s.products[id]).sort()
      .map(id => ({ id, stock_qty: String(s.products[id].stock_qty), open_po: s.products[id].open_po }));
  }
  if (text.startsWith('select id from warehouse_stock where id in')) {
    return idsOf(v[0]).filter(k => k in s.ws).sort().map(id => ({ id }));
  }
  if (text.startsWith('select id, stock_qty from warehouse_stock where id in')) {
    return idsOf(v[0]).filter(k => k in s.ws).sort().map(id => ({ id, stock_qty: String(s.ws[id]) }));
  }
  if (text.includes('from consignment_stock where id in')) {
    return idsOf(v[0]).filter(k => k in s.cs).sort()
      .map(id => ({ id, stock_qty: String(s.cs[id].qty), harga_titip: s.cs[id].harga == null ? null : String(s.cs[id].harga) }));
  }
  if (text.startsWith('select stock_qty from warehouse_stock where id = ?')) {
    return v[0] as string in s.ws ? [{ stock_qty: String(s.ws[v[0] as string]) }] : [];
  }
  if (text.startsWith('update products set stock_qty')) {
    s.products[v[2] as string].stock_qty = v[0] as number;
    return [];
  }
  if (text.startsWith('insert into warehouse_stock')) {
    s.ws[v[0] as string] = v[4] as number;
    return [];
  }
  if (text.startsWith('insert into stock_ledger')) {
    s.ledger.push({ productId: v[1] as string, warehouseId: v[3] as string | null, type: v[5] as string, qty: v[6] as number, note: v[7] as string });
    return [];
  }
  if (text.startsWith('insert into consignment_stock')) {
    s.cs[v[0] as string] = { qty: v[4] as number, harga: v[5] as number };
    return [];
  }
  if (text.startsWith('update consignment_stock set stock_qty')) {
    s.cs[v[1] as string] = { ...(s.cs[v[1] as string] ?? { harga: null }), qty: v[0] as number };
    return [];
  }
  throw new Error(`SQL tak dikenal di fake: ${text}`);
}

function makeTx() {
  return (strings: unknown, ...values: unknown[]) => {
    if (!(strings as { raw?: unknown }).raw) return new Helper(strings as unknown[]);
    const text = (strings as string[]).join('?').replace(/\s+/g, ' ').trim();
    try { return Promise.resolve(exec(h.state, text, values)); } catch (e) { return Promise.reject(e); }
  };
}

vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getSql: () => ({
    begin: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone(h.state);
      try { return await fn(makeTx()); } catch (e) { h.state = { ...snapshot, queries: h.state.queries }; throw e; }
    },
  }),
}));
vi.mock('@/lib/firebase-admin', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/history', () => ({ logHistory: vi.fn(async () => {}) }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('@/lib/low-stock', () => ({ notifyProductLowStock: vi.fn(async () => {}) }));
vi.mock('@/lib/revalidate', () => ({ revalidateProductStock: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { notifyProductLowStock } from '@/lib/low-stock';
import { revalidateProductStock } from '@/lib/revalidate';
import { revalidateTag } from 'next/cache';
import { approveShipment, rejectShipment, revalidateShipmentCaches, ShipmentActionError } from './shipment-workflow';
import { applyShipmentEffect, reverseShipmentEffect, type ShipmentEffectInput } from './shipment-effect';

const actor = { username: 'syahla', role: 'admin' } as never;
const tx = () => makeTx() as never;

function shipmentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'S1', location_id: 'L1', location_name: 'Warung A', warehouse_id: 'W1', warehouse_name: 'Gudang Utama',
    items: JSON.stringify([{ productId: 'P1', productName: 'Keripik', qty: 10, hargaTitip: 5000, subtotal: 50000 }]),
    note: 'tes', created_at: new Date('2026-11-01T03:00:00Z'), updated_at: null, status: 'draft',
    approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, reject_reason: null, created_by: 'kasir',
    ...over,
  };
}

function freshState(over: Partial<FakeState> = {}): FakeState {
  return {
    shipment: shipmentRow(),
    products: { P1: { stock_qty: 100, open_po: false }, P2: { stock_qty: 5, open_po: false } },
    ws: { W1_P1: 40, W1_P2: 5 },
    cs: {},
    ledger: [],
    queries: [],
    ...over,
  };
}

const stockSnapshot = (s: FakeState) => JSON.stringify({ p: s.products, w: s.ws, c: s.cs, l: s.ledger });

beforeEach(() => {
  h.state = freshState();
  vi.clearAllMocks();
});

describe('approveShipment', () => {
  it('draft di-approve: stok toko & gudang berkurang, stok titip bertambah, ledger out, status approved', async () => {
    const res = await approveShipment('S1', actor);
    expect(res).toEqual({ id: 'S1', locationName: 'Warung A', totalQty: 10 });
    expect(h.state.products.P1.stock_qty).toBe(90);
    expect(h.state.ws.W1_P1).toBe(30);
    expect(h.state.cs.L1_P1).toEqual({ qty: 10, harga: 5000 });
    expect(h.state.ledger).toEqual([{ productId: 'P1', warehouseId: 'W1', type: 'out', qty: 10, note: 'Kirim konsinyasi – Warung A: tes' }]);
    expect(h.state.shipment).toMatchObject({ status: 'approved', approved_by: 'syahla' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notifyProductLowStock).toHaveBeenCalledTimes(1);
    expect(logHistory).toHaveBeenCalledTimes(1);
  });

  it('stok toko kurang: ditolak dengan pesan jelas, tetap draft, tidak ada efek maupun notifikasi (rollback)', async () => {
    h.state.products.P1.stock_qty = 4;
    const before = stockSnapshot(h.state);
    await expect(approveShipment('S1', actor)).rejects.toMatchObject({
      message: 'Stok produk tidak cukup untuk dikirim: Keripik (stok toko 4, butuh 10)',
    });
    expect(h.state.shipment).toMatchObject({ status: 'draft' });
    expect(stockSnapshot(h.state)).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    expect(logHistory).not.toHaveBeenCalled();
    expect(notifyProductLowStock).not.toHaveBeenCalled();
  });

  it('stok gudang asal kurang walau stok toko cukup: ditolak, tetap draft', async () => {
    h.state.ws.W1_P1 = 3;
    const before = stockSnapshot(h.state);
    await expect(approveShipment('S1', actor)).rejects.toThrow('Stok gudang asal tidak cukup untuk dikirim: Keripik (stok di gudang ini 3, butuh 10)');
    expect(h.state.shipment).toMatchObject({ status: 'draft' });
    expect(stockSnapshot(h.state)).toBe(before);
  });

  it('approve dua kali berurutan: yang kedua 409 dan stok hanya berkurang sekali', async () => {
    await approveShipment('S1', actor);
    const after1 = stockSnapshot(h.state);
    const err = await approveShipment('S1', actor).catch(e => e);
    expect(err).toBeInstanceOf(ShipmentActionError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('Pengiriman ini sudah di-approve.');
    expect(stockSnapshot(h.state)).toBe(after1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('shipment ditolak tidak bisa di-approve (409) dan tidak menyentuh tabel stok', async () => {
    h.state.shipment = shipmentRow({ status: 'ditolak' });
    const err = await approveShipment('S1', actor).catch(e => e);
    expect(err).toMatchObject({ status: 409, message: 'Pengiriman ini sudah ditolak dan tidak bisa diubah.' });
    expect(h.state.queries.every(q => q.includes('consignment_shipments'))).toBe(true);
  });

  it('id tidak ada: 404', async () => {
    const err = await approveShipment('TIDAK-ADA', actor).catch(e => e);
    expect(err).toMatchObject({ status: 404 });
  });

  it('shipment tanpa lokasi: ditolak, stok tidak berubah', async () => {
    h.state.shipment = shipmentRow({ location_id: null });
    const before = stockSnapshot(h.state);
    await expect(approveShipment('S1', actor)).rejects.toThrow('Lokasi pengiriman tidak valid.');
    expect(stockSnapshot(h.state)).toBe(before);
  });

  it('shipment lama tanpa gudang asal tidak bisa di-approve (tidak diam-diam memotong stok toko saja)', async () => {
    h.state.shipment = shipmentRow({ warehouse_id: null });
    const before = stockSnapshot(h.state);
    await expect(approveShipment('S1', actor)).rejects.toThrow('Pilih gudang asal pengiriman.');
    expect(stockSnapshot(h.state)).toBe(before);
    expect(h.state.shipment).toMatchObject({ status: 'draft' });
  });
});

describe('rejectShipment', () => {
  it('draft ditolak: alasan dipangkas & disimpan, tanpa query ke tabel stok, tanpa notifikasi stok', async () => {
    const before = stockSnapshot(h.state);
    await rejectShipment('S1', actor, '  qty salah  ');
    expect(h.state.shipment).toMatchObject({ status: 'ditolak', rejected_by: 'syahla', reject_reason: 'qty salah' });
    expect(stockSnapshot(h.state)).toBe(before);
    expect(h.state.queries.every(q => q.includes('consignment_shipments'))).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(notifyProductLowStock).not.toHaveBeenCalled();
  });

  it('alasan kosong/spasi saja ditolak tanpa query apa pun', async () => {
    for (const r of ['', '   ', '\n\t']) {
      await expect(rejectShipment('S1', actor, r)).rejects.toThrow('Alasan penolakan wajib diisi.');
    }
    expect(h.state.queries).toHaveLength(0);
  });

  it('alasan lebih dari 500 karakter ditolak; tepat 500 diterima', async () => {
    await expect(rejectShipment('S1', actor, 'x'.repeat(501))).rejects.toThrow('maksimal 500');
    await rejectShipment('S1', actor, 'x'.repeat(500));
    expect(h.state.shipment).toMatchObject({ status: 'ditolak' });
  });

  it('shipment approved tidak bisa ditolak (409) dan stoknya tidak dibalik', async () => {
    await approveShipment('S1', actor);
    const after = stockSnapshot(h.state);
    const err = await rejectShipment('S1', actor, 'salah').catch(e => e);
    expect(err).toMatchObject({ status: 409, message: 'Pengiriman ini sudah di-approve.' });
    expect(stockSnapshot(h.state)).toBe(after);
    expect(h.state.shipment).toMatchObject({ status: 'approved' });
  });

  it('shipment yang sudah ditolak tidak bisa ditolak lagi (final)', async () => {
    await rejectShipment('S1', actor, 'a');
    const err = await rejectShipment('S1', actor, 'b').catch(e => e);
    expect(err).toMatchObject({ status: 409 });
    expect(h.state.shipment).toMatchObject({ reject_reason: 'a' });
  });

  it('id tidak ada: 404', async () => {
    expect(await rejectShipment('X', actor, 'a').catch(e => e)).toMatchObject({ status: 404 });
  });
});

describe('revalidateShipmentCaches', () => {
  it('revalidateProductStock hanya dipanggil bila stok berubah (approve), tidak untuk tolak', () => {
    revalidateShipmentCaches(['a', 'b']);
    expect(revalidateProductStock).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledTimes(3); // 2 tag nota + daftar
    revalidateShipmentCaches(['a'], { stock: true });
    expect(revalidateProductStock).toHaveBeenCalledTimes(1);
  });
});

describe('applyShipmentEffect / reverseShipmentEffect (kesetaraan dengan kode lama)', () => {
  const ship = (items: ShipmentEffectInput['items'], over: Partial<ShipmentEffectInput> = {}): ShipmentEffectInput => ({
    locationId: 'L1', locationName: 'Warung A', warehouseId: 'W1', warehouseName: 'Gudang Utama', note: null, items, ...over,
  });
  const item = (qty: number, hargaTitip = 5000, productId = 'P1') => ({ productId, productName: productId === 'P1' ? 'Keripik' : 'Basreng', qty, hargaTitip });

  it('harga titip rata-rata tertimbang terhadap stok titip yang ada (10 @4000 + 30 @5000 = 4750)', async () => {
    h.state.cs.L1_P1 = { qty: 10, harga: 4000 };
    await applyShipmentEffect(tx(), ship([item(30)]));
    expect(h.state.cs.L1_P1).toEqual({ qty: 40, harga: 4750 });
  });

  it('harga titip stok lama NULL dihitung 0 (sama dengan kode lama)', async () => {
    h.state.cs.L1_P1 = { qty: 10, harga: null };
    await applyShipmentEffect(tx(), ship([item(10, 6000)]));
    expect(h.state.cs.L1_P1).toEqual({ qty: 20, harga: 3000 });
  });

  it('baris ganda produk yang sama: validasi stok digabung (3+3 > stok 5 ditolak, tanpa efek parsial)', async () => {
    h.state.products.P2.stock_qty = 5;
    const before = stockSnapshot(h.state);
    await expect(applyShipmentEffect(tx(), ship([item(3, 5000, 'P2'), item(3, 5000, 'P2')])))
      .rejects.toThrow('Stok produk tidak cukup untuk dikirim: Basreng (stok toko 5, butuh 6)');
    expect(stockSnapshot(h.state)).toBe(before);
  });

  it('baris ganda yang cukup: stok berkurang total & harga rata-rata tertimbang antar baris, ledger per baris', async () => {
    await applyShipmentEffect(tx(), ship([item(10, 4000), item(30, 5000)]));
    expect(h.state.products.P1.stock_qty).toBe(60);
    expect(h.state.ws.W1_P1).toBe(0);
    expect(h.state.cs.L1_P1).toEqual({ qty: 40, harga: 4750 });
    expect(h.state.ledger).toHaveLength(2);
  });

  it('produk tidak ditemukan dilaporkan sebagai kekurangan', async () => {
    await expect(applyShipmentEffect(tx(), ship([item(1, 100, 'HILANG')]))).rejects.toThrow('(produk tidak ditemukan)');
  });

  it('label ledger "(diedit)" hanya untuk edit; catatan ikut dilampirkan', async () => {
    await applyShipmentEffect(tx(), ship([item(1)], { note: 'rak depan' }), { edited: true });
    expect(h.state.ledger[0].note).toBe('Kirim konsinyasi (diedit) – Warung A: rak depan');
  });

  it('apply lalu reverse mengembalikan stok toko & gudang, dan mengosongkan stok titip', async () => {
    const before = JSON.parse(stockSnapshot(h.state));
    await applyShipmentEffect(tx(), ship([item(10)]));
    await reverseShipmentEffect(tx(), ship([item(10)]), { context: 'delete' });
    expect(h.state.products).toEqual(before.p);
    expect(h.state.ws).toEqual(before.w);
    expect(h.state.cs.L1_P1.qty).toBe(0);
    expect(h.state.ledger.map(l => l.type)).toEqual(['out', 'in']);
    expect(h.state.ledger[1].note).toBe('Hapus kirim konsinyasi – Warung A');
  });

  it('reverse ditolak bila stok titip sudah terjual (pesan hapus vs edit berbeda), tanpa efek parsial', async () => {
    await applyShipmentEffect(tx(), ship([item(10)]));
    h.state.cs.L1_P1.qty = 4; // 6 sudah terjual/direkap
    const before = stockSnapshot(h.state);
    await expect(reverseShipmentEffect(tx(), ship([item(10)]), { context: 'delete' }))
      .rejects.toThrow('Tidak bisa menghapus — sebagian stok kiriman ini sudah terjual/direkap: Keripik (stok titip tersisa 4, butuh 10)');
    await expect(reverseShipmentEffect(tx(), ship([item(10)]), { context: 'edit' }))
      .rejects.toThrow('Tidak bisa mengubah — sebagian stok kiriman lama sudah terjual/direkap');
    expect(stockSnapshot(h.state)).toBe(before);
  });

  it('reverse shipment lama tanpa warehouse_id: stok toko & titip dibalik, gudang & ledger tidak disentuh', async () => {
    h.state.cs.L1_P1 = { qty: 10, harga: 5000 };
    const wsBefore = JSON.stringify(h.state.ws);
    await reverseShipmentEffect(tx(), ship([item(10)], { warehouseId: null, warehouseName: null }), { context: 'delete' });
    expect(h.state.products.P1.stock_qty).toBe(110);
    expect(h.state.cs.L1_P1.qty).toBe(0);
    expect(JSON.stringify(h.state.ws)).toBe(wsBefore);
    expect(h.state.ledger).toHaveLength(0);
  });

  it('edit approved tanpa perubahan (reverse lalu apply, stok gudang habis tepat) tidak gagal', async () => {
    h.state.ws.W1_P1 = 10; h.state.products.P1.stock_qty = 10;
    await applyShipmentEffect(tx(), ship([item(10)]));
    expect(h.state.ws.W1_P1).toBe(0);
    await reverseShipmentEffect(tx(), ship([item(10)]), { context: 'edit' });
    await applyShipmentEffect(tx(), ship([item(10)]), { edited: true });
    expect(h.state.products.P1.stock_qty).toBe(0);
    expect(h.state.cs.L1_P1.qty).toBe(10);
  });

  it('reverse dengan baris ganda produk sama mengurangi stok titip total', async () => {
    h.state.cs.L1_P1 = { qty: 40, harga: 4750 };
    await reverseShipmentEffect(tx(), ship([item(10, 4000), item(30, 5000)]), { context: 'delete' });
    expect(h.state.cs.L1_P1.qty).toBe(0);
    expect(h.state.products.P1.stock_qty).toBe(140);
  });
});
