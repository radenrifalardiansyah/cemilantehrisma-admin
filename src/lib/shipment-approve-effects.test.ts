import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentActionError } from './shipment-status';

// Tes kecepatan approve: efek samping pasca-commit paralel & best-effort, bulk tetap berurutan di fase DB,
// efek dijalankan lewat after() SETELAH respons, revalidate dipanggil sebelum respons.
// DB/efek stok dipalsukan; yang diuji adalah orkestrasi (urutan & konkurensi), bukan SQL.

const h = vi.hoisted(() => ({
  events: [] as string[],
  afterJobs: [] as (() => unknown)[],
  failApply: new Set<string>(),
  inFlight: 0, maxInFlight: 0,
  gate: null as null | Promise<void>,
}));

vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getSql: () => {
    const tx = (strings: TemplateStringsArray, ...v: unknown[]) => {
      const text = strings.join('?');
      if (text.includes('from consignment_shipments where id = ? for update')) {
        return Promise.resolve([{
          id: v[0], location_id: 'L1', location_name: `Loc-${v[0]}`, warehouse_id: 'W1', warehouse_name: 'Gudang',
          items: [{ productId: 'P1', productName: 'Teh', qty: 2, hargaTitip: 1000, subtotal: 2000 }],
          note: '', status: 'draft', created_at: new Date(), updated_at: null,
        }]);
      }
      return Promise.resolve([]);
    };
    const sql = (() => Promise.resolve([{ location_name: 'X' }])) as unknown as Record<string, unknown>;
    sql.begin = async (cb: (t: unknown) => unknown) => cb(tx);
    return sql;
  },
}));
vi.mock('@/lib/shipment-effect', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/shipment-effect')>()),
  applyShipmentEffect: vi.fn(async (_tx: unknown, s: { locationName: string }) => {
    const id = s.locationName.replace('Loc-', '');
    h.events.push(`db:start:${id}`);
    await Promise.resolve();
    if (h.failApply.has(id)) throw new ShipmentActionError(`Stok kurang ${id}`);
    h.events.push(`db:end:${id}`);
    return new Map([['P1', 7]]);
  }),
}));
vi.mock('@/lib/firebase-admin', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => ({ username: 'syahla', role: 'admin' })) }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn((t: string) => { h.events.push(`revalidate:${t}`); }) }));
vi.mock('@/lib/revalidate', () => ({ revalidateProductStock: vi.fn(() => { h.events.push('revalidate:stock'); }) }));
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (job: () => unknown) => { h.events.push('after:scheduled'); h.afterJobs.push(job); },
}));

const track = async (name: string, fn?: () => Promise<void>) => {
  h.events.push(`${name}:start`);
  h.inFlight++; h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
  try { await h.gate; await fn?.(); } finally { h.inFlight--; }
  h.events.push(`${name}:end`);
};
vi.mock('@/lib/history', () => ({ logHistory: vi.fn(async () => track('history')) }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => track('notify')) }));
vi.mock('@/lib/low-stock', () => ({ notifyProductLowStock: vi.fn(async () => track('lowstock')) }));

import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { notifyProductLowStock } from '@/lib/low-stock';
import { approveShipment, approveShipmentDb } from './shipment-workflow';
import { POST as bulkApprove } from '@/app/api/consignment/send/bulk-approve/route';
import { POST as singleApprove } from '@/app/api/consignment/send/[id]/approve/route';

const actor = { username: 'syahla', role: 'admin' } as never;
const bulkReq = (ids: unknown) => new Request('http://x/bulk', { method: 'POST', body: JSON.stringify({ ids }) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.events = []; h.afterJobs = []; h.failApply = new Set(); h.inFlight = 0; h.maxInFlight = 0; h.gate = null;
});

describe('approveShipment: efek samping paralel dan best-effort', () => {
  it('riwayat, notifikasi, low-stock mulai bersamaan (paralel), masing-masing tepat sekali', async () => {
    let release!: () => void;
    h.gate = new Promise<void>(r => { release = r; });
    const p = approveShipment('S1', actor);
    await vi.waitFor(() => expect(h.maxInFlight).toBe(3));
    release();
    await expect(p).resolves.toMatchObject({ id: 'S1', locationName: 'Loc-S1', totalQty: 2 });
    expect(logHistory).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notifyProductLowStock).toHaveBeenCalledTimes(1);
    // low-stock menerima stok sesudah approve dari dalam transaksi
    expect((notifyProductLowStock as ReturnType<typeof vi.fn>).mock.calls[0][4]).toEqual(new Map([['P1', 7]]));
  });

  it('satu efek gagal tidak menggagalkan approve maupun efek lain; error dilog', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    (logHistory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('firestore down'));
    await expect(approveShipment('S1', actor)).resolves.toMatchObject({ id: 'S1' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notifyProductLowStock).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
  });

  it('approveShipmentDb tidak menjalankan efek sebelum runEffects dipanggil', async () => {
    const out = await approveShipmentDb('S1', actor);
    expect(logHistory).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    await out.runEffects();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('bulk-approve: DB berurutan, efek via after() setelah respons', () => {
  it('fase DB berurutan; revalidate sebelum respons; efek belum jalan saat respons kembali', async () => {
    const res = await bulkApprove(bulkReq(['A', 'B', 'C']));
    expect(await res.json()).toEqual({ approved: 3, failed: [] });
    const db = h.events.filter(e => e.startsWith('db:'));
    expect(db).toEqual(['db:start:A', 'db:end:A', 'db:start:B', 'db:end:B', 'db:start:C', 'db:end:C']);
    // efek belum berjalan, hanya dijadwalkan (satu kali), setelah revalidate
    expect(h.events.some(e => e.startsWith('history') || e.startsWith('notify'))).toBe(false);
    expect(h.afterJobs).toHaveLength(1);
    expect(h.events.indexOf('revalidate:stock')).toBeGreaterThan(-1);
    expect(h.events.indexOf('revalidate:stock')).toBeLessThan(h.events.indexOf('after:scheduled'));
    expect(notify).not.toHaveBeenCalled();

    await h.afterJobs[0]();
    expect(logHistory).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notifyProductLowStock).toHaveBeenCalledTimes(3);
  });

  it('yang gagal (stok kurang) dilaporkan sama seperti dulu dan tidak punya efek; yang lain tetap', async () => {
    h.failApply.add('B');
    const res = await bulkApprove(bulkReq(['A', 'B', 'C']));
    const body = await res.json();
    expect(body.approved).toBe(2);
    expect(body.failed).toEqual([{ id: 'B', label: 'X', reason: 'Stok kurang B' }]);
    await h.afterJobs[0]();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(logHistory).toHaveBeenCalledTimes(2);
  });

  it('semua gagal: tanpa revalidate dan tanpa after()', async () => {
    h.failApply = new Set(['A', 'B']);
    const res = await bulkApprove(bulkReq(['A', 'B']));
    expect((await res.json()).approved).toBe(0);
    expect(h.afterJobs).toHaveLength(0);
    expect(h.events.some(e => e.startsWith('revalidate'))).toBe(false);
  });

  it('konkurensi efek antar-shipment dibatasi (3 shipment x 3 efek, maks 9 serentak; 6 shipment tidak lebih dari 9)', async () => {
    let release!: () => void;
    h.gate = new Promise<void>(r => { release = r; });
    await bulkApprove(bulkReq(['A', 'B', 'C', 'D', 'E', 'F']));
    const job = h.afterJobs[0]() as Promise<void>;
    await vi.waitFor(() => expect(h.inFlight).toBeGreaterThan(0));
    release();
    await job;
    expect(h.maxInFlight).toBeLessThanOrEqual(9);
    expect(notify).toHaveBeenCalledTimes(6);
  });

  it('efek yang gagal di after() tidak menghentikan efek lain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    (notify as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fcm'));
    await bulkApprove(bulkReq(['A', 'B']));
    await expect(h.afterJobs[0]()).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(logHistory).toHaveBeenCalledTimes(2);
  });
});

describe('approve satuan: efek via after() setelah revalidate', () => {
  it('respons ok, revalidate sebelum after, efek berjalan saat job after dieksekusi', async () => {
    const res = await singleApprove(new Request('http://x/a', { method: 'POST' }) as never, { params: Promise.resolve({ id: 'S1' }) });
    expect(await res.json()).toEqual({ ok: true });
    expect(h.afterJobs).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    expect(h.events.indexOf('revalidate:stock')).toBeLessThan(h.events.indexOf('after:scheduled'));
    await h.afterJobs[0]();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(logHistory).toHaveBeenCalledTimes(1);
  });

  it('approve gagal: 4xx, tanpa after()', async () => {
    h.failApply.add('S1');
    const res = await singleApprove(new Request('http://x/a', { method: 'POST' }) as never, { params: Promise.resolve({ id: 'S1' }) });
    expect(res.status).toBe(400);
    expect(h.afterJobs).toHaveLength(0);
  });
});
