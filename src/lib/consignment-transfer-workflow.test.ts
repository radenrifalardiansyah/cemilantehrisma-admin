import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes perilaku Transfer Stok Antar Mitra memakai "Postgres" palsu di memori (pola sama dengan shipment-workflow.test.ts):
// transaksi menyalin state dan mengembalikannya saat melempar error, jadi rollback ikut teruji. Query yang tak dikenal
// sengaja melempar error — mis. products/warehouse_stock TIDAK boleh tersentuh dan draft/ditolak tidak boleh menyentuh stok.
// BUKAN pengganti uji terhadap Postgres sungguhan (penguncian baris/deadlock tidak ditiru; yang diuji: satu query kunci terurut).

interface FakeState {
  transfers: Record<string, Record<string, unknown>>;
  locations: Record<string, { name: string; is_active: boolean | null }>;
  products: Record<string, string>; // id -> nama (hanya dibaca validasi create)
  cs: Record<string, { loc: string; pid: string; qty: number; harga: number | null }>;
  counters: Record<string, number>;
  queries: string[];
}

const h = vi.hoisted(() => ({ state: null as unknown as FakeState }));

class Helper { constructor(public ids: unknown[]) {} }

function exec(s: FakeState, text: string, v: unknown[]): unknown[] {
  s.queries.push(text);
  const idsOf = (x: unknown) => (x as Helper).ids as string[];
  if (text.includes('from consignment_transfers where id = ? for update')) {
    const t = s.transfers[v[0] as string];
    return t ? [{ ...t }] : [];
  }
  if (text.startsWith('select id, name, is_active from consignment_locations where id in')) {
    return [v[0], v[1]].filter(id => (id as string) in s.locations).map(id => ({ id, ...s.locations[id as string] }));
  }
  if (text.includes('from consignment_stock where id in') && text.includes('order by id for update')) {
    return idsOf(v[0]).filter(k => k in s.cs).sort()
      .map(id => ({ id, stock_qty: String(s.cs[id].qty), harga_titip: s.cs[id].harga == null ? null : String(s.cs[id].harga) }));
  }
  if (text.startsWith('insert into consignment_stock')) {
    // values: key, locationId, productId, productName, qty, harga, qty, harga
    s.cs[v[0] as string] = { loc: v[1] as string, pid: v[2] as string, qty: v[4] as number, harga: v[5] as number };
    return [];
  }
  if (text.startsWith('select items from consignment_shipments')) return []; // kiriman stok: tidak ada di fake ini
  if (text.startsWith('select items from consignment_transfers')) {
    // transfer masuk approved ke lokasi v[0] (kecuali id v[1])
    return Object.values(s.transfers)
      .filter(t => t.to_location_id === v[0] && t.status === 'approved' && t.id !== v[1])
      .map(t => ({ items: t.items }));
  }
  if (text.startsWith("update consignment_transfers set status = 'approved'")) {
    s.transfers[v[2] as string] = { ...s.transfers[v[2] as string], status: 'approved', items: v[0], approved_by: v[1] };
    return [];
  }
  if (text.startsWith("update consignment_transfers set status = 'dibatalkan'")) {
    s.transfers[v[1] as string] = { ...s.transfers[v[1] as string], status: 'dibatalkan', cancelled_by: v[0] };
    return [];
  }
  if (text.startsWith("update consignment_transfers set status = 'ditolak'")) {
    s.transfers[v[2] as string] = { ...s.transfers[v[2] as string], status: 'ditolak', rejected_by: v[0], reject_reason: v[1] };
    return [];
  }
  if (text.startsWith('delete from consignment_transfers where id = ?')) {
    delete s.transfers[v[0] as string];
    return [];
  }
  if (text.startsWith('update consignment_transfers set from_location_id')) {
    // values: from, to, fromName, toName, items, note, docDate, id
    s.transfers[v[7] as string] = { ...s.transfers[v[7] as string], from_location_id: v[0], to_location_id: v[1], from_location_name: v[2], to_location_name: v[3], items: v[4], note: v[5] };
    return [];
  }
  if (text.startsWith('insert into doc_counters')) {
    const key = v[0] as string;
    s.counters[key] = (s.counters[key] ?? 0) + 1;
    return [{ last_value: s.counters[key] }];
  }
  if (text.startsWith('insert into consignment_transfers')) {
    // values: id, number, from, to, fromName, toName, items, note, docDate, actor
    s.transfers[v[0] as string] = {
      id: v[0], doc_number: v[1], from_location_id: v[2], to_location_id: v[3], from_location_name: v[4], to_location_name: v[5],
      items: v[6], note: v[7], doc_date: v[8], status: 'draft', created_by: v[9], created_at: new Date(), updated_at: null,
    };
    return [];
  }
  if (text.startsWith('select id, name from products where id in')) {
    return idsOf(v[0]).filter(id => id in s.products).map(id => ({ id, name: s.products[id] }));
  }
  if (text.startsWith('select product_id, stock_qty from consignment_stock where location_id = ?')) {
    return idsOf(v[1]).map(pid => s.cs[`${v[0]}_${pid}`]).filter(Boolean).map(r => ({ product_id: r.pid, stock_qty: String(r.qty) }));
  }
  throw new Error(`SQL tak dikenal di fake: ${text}`);
}

function makeTag() {
  const run = (strings: unknown, ...values: unknown[]) => {
    if (!(strings as { raw?: unknown }).raw) return new Helper(strings as unknown[]);
    const text = (strings as string[]).join('?').replace(/\s+/g, ' ').trim();
    try { return Promise.resolve(exec(h.state, text, values)); } catch (e) { return Promise.reject(e); }
  };
  return run;
}

vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getSql: () => Object.assign(makeTag(), {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone(h.state);
      try { return await fn(makeTag()); } catch (e) { h.state = { ...snapshot, queries: h.state.queries }; throw e; }
    },
  }),
}));
vi.mock('@/lib/firebase-admin', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/history', () => ({ logHistory: vi.fn(async () => {}) }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('@/lib/revalidate', () => ({ revalidateProductStock: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { revalidateTag } from 'next/cache';
import {
  approveTransfer, rejectTransfer, cancelTransfer, deleteTransfer, createTransferDraft, updateTransferDraft,
  revalidateTransferCaches, TransferActionError,
} from './consignment-transfer-workflow';
import { loadInboundPriceRanges } from './shipment-effect';

const actor = { username: 'syahla', role: 'admin' } as never;

function transferRow(over: Record<string, unknown> = {}) {
  return {
    id: 'T1', doc_number: 'TMP-202611-0001', from_location_id: 'A', to_location_id: 'B', from_location_name: 'Mitra A', to_location_name: 'Mitra B',
    items: JSON.stringify([{ productId: 'P1', productName: 'Keripik', qty: 10, hargaTitip: 0 }]),
    note: '', doc_date: new Date('2026-11-01T03:00:00Z'), status: 'draft', created_by: 'kasir',
    approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, reject_reason: null, cancelled_by: null, cancelled_at: null,
    created_at: new Date('2026-11-01T03:00:00Z'), updated_at: null,
    ...over,
  };
}

function freshState(over: Partial<FakeState> = {}): FakeState {
  return {
    transfers: { T1: transferRow() },
    locations: { A: { name: 'Mitra A', is_active: true }, B: { name: 'Mitra B', is_active: true } },
    products: { P1: 'Keripik', P2: 'Mie' },
    cs: {
      A_P1: { loc: 'A', pid: 'P1', qty: 30, harga: 6000 },
      B_P1: { loc: 'B', pid: 'P1', qty: 10, harga: 4000 },
    },
    counters: {},
    queries: [],
    ...over,
  };
}

const csSnapshot = (s: FakeState) => JSON.stringify(s.cs);
const status = () => h.state.transfers.T1?.status;

beforeEach(() => {
  h.state = freshState();
  vi.clearAllMocks();
});

describe('approveTransfer', () => {
  it('stok A berkurang (harga A tetap), stok B bertambah dengan harga rata-rata tertimbang, harga snapshot disimpan', async () => {
    const res = await approveTransfer('T1', actor);
    expect(res).toEqual({ id: 'T1', docNumber: 'TMP-202611-0001', totalQty: 10 });
    expect(h.state.cs.A_P1).toMatchObject({ qty: 20, harga: 6000 });
    // (10*4000 + 10*6000) / 20 = 5000
    expect(h.state.cs.B_P1).toMatchObject({ qty: 20, harga: 5000 });
    expect(status()).toBe('approved');
    expect(h.state.transfers.T1.approved_by).toBe('syahla');
    expect(JSON.parse(h.state.transfers.T1.items as string)).toEqual([{ productId: 'P1', productName: 'Keripik', qty: 10, hargaTitip: 6000 }]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(logHistory).toHaveBeenCalledTimes(1);
  });

  it('tidak menyentuh products / warehouse_stock / stock_ledger', async () => {
    await approveTransfer('T1', actor);
    expect(h.state.queries.some(q => /products|warehouse_stock|stock_ledger/.test(q))).toBe(false);
  });

  it('baris stok B belum ada: dibuat dengan harga A saat approve', async () => {
    delete h.state.cs.B_P1;
    await approveTransfer('T1', actor);
    expect(h.state.cs.B_P1).toMatchObject({ loc: 'B', qty: 10, harga: 6000 });
  });

  it('stok A kurang: ditolak dengan pesan jelas, tetap draft, stok tidak berubah, tanpa notifikasi', async () => {
    h.state.cs.A_P1.qty = 4;
    const before = csSnapshot(h.state);
    await expect(approveTransfer('T1', actor)).rejects.toMatchObject({
      status: 400, message: 'Stok mitra asal tidak cukup untuk dipindahkan: Keripik (stok di Mitra A 4, butuh 10)',
    });
    expect(status()).toBe('draft');
    expect(csSnapshot(h.state)).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    expect(logHistory).not.toHaveBeenCalled();
  });

  it('produk tidak punya baris stok di A: ditolak', async () => {
    delete h.state.cs.A_P1;
    await expect(approveTransfer('T1', actor)).rejects.toThrow('tidak ada stok di Mitra A');
    expect(status()).toBe('draft');
  });

  it('produk duplikat di dokumen digabung saat validasi stok dan saat dikurangi', async () => {
    h.state.transfers.T1.items = JSON.stringify([
      { productId: 'P1', productName: 'Keripik', qty: 6, hargaTitip: 0 }, { productId: 'P1', productName: 'Keripik', qty: 5, hargaTitip: 0 },
    ]);
    h.state.cs.A_P1.qty = 10; // 6 + 5 = 11 > 10 → harus ditolak walau masing-masing baris cukup
    await expect(approveTransfer('T1', actor)).rejects.toThrow('stok di Mitra A 10, butuh 11');
    h.state.cs.A_P1.qty = 30;
    await approveTransfer('T1', actor);
    expect(h.state.cs.A_P1.qty).toBe(19);
    expect(h.state.cs.B_P1.qty).toBe(21);
    expect(JSON.parse(h.state.transfers.T1.items as string)).toHaveLength(1);
  });

  it('approve dua kali: yang kedua 409 dan stok hanya berpindah sekali', async () => {
    await approveTransfer('T1', actor);
    const after1 = csSnapshot(h.state);
    const err = await approveTransfer('T1', actor).catch(e => e);
    expect(err).toBeInstanceOf(TransferActionError);
    expect(err).toMatchObject({ status: 409, message: 'Transfer ini sudah di-approve.' });
    expect(csSnapshot(h.state)).toBe(after1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('mitra nonaktif (asal atau tujuan) ditolak saat approve dan stok tidak berubah', async () => {
    const before = csSnapshot(h.state);
    h.state.locations.B.is_active = false;
    await expect(approveTransfer('T1', actor)).rejects.toThrow('Mitra tujuan "Mitra B" nonaktif.');
    h.state.locations.B.is_active = true;
    h.state.locations.A.is_active = false;
    await expect(approveTransfer('T1', actor)).rejects.toThrow('Mitra asal "Mitra A" nonaktif.');
    expect(status()).toBe('draft');
    expect(csSnapshot(h.state)).toBe(before);
  });

  it('id tidak ada: 404', async () => {
    await expect(approveTransfer('X', actor)).rejects.toMatchObject({ status: 404 });
  });

  it('kunci baris stok: SATU query terurut (order by id for update) memuat kedua lokasi — A->B dan B->A tak bisa deadlock', async () => {
    await approveTransfer('T1', actor);
    const locks = h.state.queries.filter(q => q.includes('from consignment_stock where id in'));
    expect(locks).toHaveLength(1);
    expect(locks[0]).toContain('order by id for update');
    // Transfer arah sebaliknya memakai bentuk query yang sama (urutan id ditentukan DB, bukan urutan argumen).
    h.state.transfers.T2 = transferRow({ id: 'T2', from_location_id: 'B', to_location_id: 'A', from_location_name: 'Mitra B', to_location_name: 'Mitra A' });
    h.state.queries.length = 0;
    await approveTransfer('T2', actor);
    const locks2 = h.state.queries.filter(q => q.includes('from consignment_stock where id in'));
    expect(locks2).toEqual(locks);
  });
});

describe('cancelTransfer', () => {
  it('membalik efek: A dan B kembali ke stok & harga semula', async () => {
    const before = csSnapshot(h.state);
    await approveTransfer('T1', actor);
    expect(csSnapshot(h.state)).not.toBe(before);
    await cancelTransfer('T1', actor);
    expect(h.state.cs.A_P1).toMatchObject({ qty: 30, harga: 6000 });
    expect(h.state.cs.B_P1).toMatchObject({ qty: 10, harga: 4000 });
    expect(status()).toBe('dibatalkan');
    expect(h.state.transfers.T1.cancelled_by).toBe('syahla');
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('ditolak (dokumen tetap approved) bila stok B sekarang kurang dari qty', async () => {
    await approveTransfer('T1', actor);
    h.state.cs.B_P1.qty = 4; // sebagian sudah terjual
    const before = csSnapshot(h.state);
    await expect(cancelTransfer('T1', actor)).rejects.toThrow('Tidak bisa membatalkan — sebagian stok transfer ini mungkin sudah terjual/direkap atau dipindah lagi dari Mitra B: Keripik (stok di Mitra B tersisa 4, butuh 10)');
    expect(status()).toBe('approved');
    expect(csSnapshot(h.state)).toBe(before);
  });

  it('harga B dijepit ke rentang harga transfer masuk lain', async () => {
    // B menerima juga transfer lain (T0, approved, 5 @ 4500) → harga B tak boleh keluar dari [4500, 6000] setelah T1 dibatalkan.
    h.state.transfers.T0 = transferRow({ id: 'T0', from_location_id: 'C', to_location_id: 'B', status: 'approved', items: JSON.stringify([{ productId: 'P1', productName: 'Keripik', qty: 5, hargaTitip: 4500 }]) });
    h.state.cs.B_P1 = { loc: 'B', pid: 'P1', qty: 15, harga: 4500 };
    await approveTransfer('T1', actor); // 25 @ (15*4500+10*6000)/25 = 5100
    expect(h.state.cs.B_P1.harga).toBeCloseTo(5100);
    await cancelTransfer('T1', actor);
    expect(h.state.cs.B_P1.qty).toBe(15);
    expect(h.state.cs.B_P1.harga).toBeCloseTo(4500);
  });

  it('draft/ditolak/dibatalkan tidak bisa dibatalkan (409) dan tidak menyentuh stok', async () => {
    for (const st of ['draft', 'ditolak', 'dibatalkan']) {
      h.state.transfers.T1 = transferRow({ status: st });
      h.state.queries.length = 0;
      await expect(cancelTransfer('T1', actor)).rejects.toMatchObject({ status: 409, message: 'Hanya transfer berstatus approved yang bisa dibatalkan.' });
      expect(h.state.queries.some(q => q.includes('consignment_stock'))).toBe(false);
    }
  });
});

describe('rejectTransfer & status non-approved', () => {
  it('tolak draft: status ditolak, stok tidak disentuh sama sekali', async () => {
    const before = csSnapshot(h.state);
    await rejectTransfer('T1', actor, ' salah mitra ');
    expect(status()).toBe('ditolak');
    expect(h.state.transfers.T1.reject_reason).toBe('salah mitra');
    expect(csSnapshot(h.state)).toBe(before);
    expect(h.state.queries.some(q => q.includes('consignment_stock'))).toBe(false);
  });

  it('alasan opsional', async () => {
    await rejectTransfer('T1', actor, '');
    expect(h.state.transfers.T1.reject_reason).toBeNull();
  });

  it('ditolak/dibatalkan tidak bisa di-approve (409) dan tidak menyentuh stok', async () => {
    for (const st of ['ditolak', 'dibatalkan']) {
      h.state.transfers.T1 = transferRow({ status: st });
      h.state.queries.length = 0;
      await expect(approveTransfer('T1', actor)).rejects.toMatchObject({ status: 409 });
      expect(h.state.queries.some(q => q.includes('consignment_stock'))).toBe(false);
    }
  });

  it('approved tidak bisa ditolak (409)', async () => {
    await approveTransfer('T1', actor);
    await expect(rejectTransfer('T1', actor, 'x')).rejects.toMatchObject({ status: 409 });
  });
});

describe('deleteTransfer & updateTransferDraft', () => {
  it('hapus approved ditolak 409; draft/ditolak/dibatalkan boleh dihapus tanpa menyentuh stok', async () => {
    await approveTransfer('T1', actor);
    await expect(deleteTransfer('T1', actor)).rejects.toMatchObject({ status: 409, message: 'Transfer yang sudah di-approve tidak bisa dihapus — batalkan dulu.' });
    expect(h.state.transfers.T1).toBeDefined();
    for (const st of ['draft', 'ditolak', 'dibatalkan']) {
      h.state.transfers.T1 = transferRow({ status: st });
      const before = csSnapshot(h.state);
      await deleteTransfer('T1', actor);
      expect(h.state.transfers.T1).toBeUndefined();
      expect(csSnapshot(h.state)).toBe(before);
    }
  });

  it('hapus id tidak ada: 404', async () => {
    await expect(deleteTransfer('X', actor)).rejects.toMatchObject({ status: 404 });
  });

  it('edit approved ditolak 409 (hanya draft yang bisa diedit)', async () => {
    await approveTransfer('T1', actor);
    await expect(updateTransferDraft('T1', { fromLocationId: 'A', toLocationId: 'B', items: [{ productId: 'P1', qty: 2 }] }, actor))
      .rejects.toMatchObject({ status: 409 });
  });

  it('edit draft: menulis ulang dokumen, stok tidak berubah', async () => {
    const before = csSnapshot(h.state);
    await updateTransferDraft('T1', { fromLocationId: 'A', toLocationId: 'B', items: [{ productId: 'P1', qty: 3 }], note: 'ubah' }, actor);
    expect(JSON.parse(h.state.transfers.T1.items as string)).toEqual([{ productId: 'P1', productName: 'Keripik', qty: 3, hargaTitip: 0 }]);
    expect(h.state.transfers.T1.note).toBe('ubah');
    expect(csSnapshot(h.state)).toBe(before);
  });
});

describe('createTransferDraft (validasi server)', () => {
  const body = (over: Record<string, unknown> = {}) => ({ fromLocationId: 'A', toLocationId: 'B', items: [{ productId: 'P1', qty: 5 }], ...over });

  it('membuat draft bernomor TMP-yyyymm-0001 tanpa efek stok; produk duplikat digabung; nama produk dari server', async () => {
    const before = csSnapshot(h.state);
    const { id, docNumber } = await createTransferDraft(body({ items: [{ productId: 'P1', qty: 5 }, { productId: 'P1', qty: 7 }], date: '2026-11-05T03:00:00Z' }), actor);
    expect(docNumber).toMatch(/^TMP-202611-0001$/);
    expect(h.state.transfers[id].status).toBe('draft');
    expect(JSON.parse(h.state.transfers[id].items as string)).toEqual([{ productId: 'P1', productName: 'Keripik', qty: 12, hargaTitip: 0 }]);
    expect(csSnapshot(h.state)).toBe(before);
  });

  it('from == to ditolak', async () => {
    await expect(createTransferDraft(body({ toLocationId: 'A' }), actor)).rejects.toThrow('Mitra asal dan tujuan tidak boleh sama.');
  });

  it('mitra tidak ada / nonaktif ditolak', async () => {
    await expect(createTransferDraft(body({ toLocationId: 'Z' }), actor)).rejects.toThrow('Mitra tujuan tidak ditemukan.');
    h.state.locations.A.is_active = false;
    await expect(createTransferDraft(body(), actor)).rejects.toThrow('Mitra asal "Mitra A" nonaktif.');
    h.state.locations.A.is_active = true;
    h.state.locations.B.is_active = false;
    await expect(createTransferDraft(body(), actor)).rejects.toThrow('Mitra tujuan "Mitra B" nonaktif.');
  });

  it('qty <= 0, kosong, atau bukan angka ditolak', async () => {
    await expect(createTransferDraft(body({ items: [] }), actor)).rejects.toThrow('Minimal 1 produk');
    await expect(createTransferDraft(body({ items: [{ productId: 'P1', qty: 0 }] }), actor)).rejects.toThrow('lebih dari 0');
    await expect(createTransferDraft(body({ items: [{ productId: 'P1', qty: -2 }] }), actor)).rejects.toThrow('lebih dari 0');
    await expect(createTransferDraft(body({ items: [{ productId: 'P1', qty: '5' }] }), actor)).rejects.toThrow('lebih dari 0');
  });

  it('produk tak ada di stok mitra asal atau stok kurang: ditolak dini', async () => {
    await expect(createTransferDraft(body({ items: [{ productId: 'P2', qty: 1 }] }), actor)).rejects.toThrow('Mie (tidak ada stok di Mitra A)');
    await expect(createTransferDraft(body({ items: [{ productId: 'P1', qty: 31 }] }), actor)).rejects.toThrow('Keripik (stok di Mitra A 30, diminta 31)');
    await expect(createTransferDraft(body({ items: [{ productId: 'PX', qty: 1 }] }), actor)).rejects.toThrow('tidak ditemukan');
  });
});

describe('revalidateTransferCaches & harga masuk', () => {
  it('approve/batal membuang tag daftar transfer dan analitik mitra', () => {
    revalidateTransferCaches({ effect: true });
    expect(revalidateTag).toHaveBeenCalledWith('admin-consignment-transfers-list', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('admin-analytics-consignment', { expire: 0 });
    vi.clearAllMocks();
    revalidateTransferCaches();
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it('loadInboundPriceRanges ikut memuat harga transfer masuk approved (kecuali transfer yang dikecualikan)', async () => {
    h.state.transfers.T0 = transferRow({ id: 'T0', to_location_id: 'B', status: 'approved', items: JSON.stringify([{ productId: 'P1', productName: 'Keripik', qty: 5, hargaTitip: 4500 }]) });
    h.state.transfers.T9 = transferRow({ id: 'T9', to_location_id: 'B', status: 'approved', items: JSON.stringify([{ productId: 'P1', productName: 'Keripik', qty: 5, hargaTitip: 9000 }]) });
    const tx = makeTag() as never;
    const ranges = await loadInboundPriceRanges(tx, { locationId: 'B', productIds: ['P1'], excludeTransferId: 'T9' });
    expect(ranges.get('B_P1')).toMatchObject({ lo: 4500, hi: 4500, qSum: 5 });
  });
});
