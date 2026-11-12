import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes perbaikan review: batas bulk-approve, normalisasi item PUT, pesan error generik, tag nota.

const h = vi.hoisted(() => ({ beginError: null as unknown }));

vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getSql: () => {
    const sql = (() => Promise.resolve([{ location_name: 'Warung A' }])) as unknown as Record<string, unknown>;
    sql.begin = async () => { throw h.beginError; };
    return sql;
  },
}));
vi.mock('@/lib/firebase-admin', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/history', () => ({ logHistory: vi.fn(async () => {}) }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('@/lib/low-stock', () => ({ notifyProductLowStock: vi.fn(async () => {}) }));
vi.mock('@/lib/revalidate', () => ({ revalidateProductStock: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => ({ username: 'syahla', role: 'admin' })) }));

import { revalidateTag } from 'next/cache';
import { revalidateProductStock } from '@/lib/revalidate';
import { approveShipment, rejectShipment, revalidateShipmentCaches, ShipmentActionError } from './shipment-workflow';
import { normalizeEditItems, mergeItems } from './shipment-items';
import { BULK_APPROVE_MAX } from './shipment-status';
import { POST as bulkApprove } from '@/app/api/consignment/send/bulk-approve/route';

const actor = { username: 'syahla', role: 'admin' } as never;
const bulkReq = (ids: unknown) => new Request('http://x/api/consignment/send/bulk-approve', { method: 'POST', body: JSON.stringify({ ids }) }) as never;

beforeEach(() => { vi.clearAllMocks(); h.beginError = new Error('connection terminated: password authentication failed for user "postgres"'); });

describe('bulk-approve: batas per request', () => {
  it(`menolak > ${BULK_APPROVE_MAX} id dengan 400 dan pesan jelas, tanpa memproses apa pun`, async () => {
    const ids = Array.from({ length: BULK_APPROVE_MAX + 1 }, (_, i) => `S${i}`);
    const res = await bulkApprove(bulkReq(ids));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(`Maksimal ${BULK_APPROVE_MAX}`);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('id duplikat dihitung unik terhadap batas', async () => {
    const ids = Array.from({ length: BULK_APPROVE_MAX * 2 }, (_, i) => `S${i % 3}`);
    const res = await bulkApprove(bulkReq(ids));
    expect(res.status).toBe(200);
  });

  it('error DB tak terduga: alasan per item generik (tidak bocor), tidak ada yang approved, cache tidak dibuang', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await bulkApprove(bulkReq(['S1', 'S2']));
    const body = await res.json();
    expect(body.approved).toBe(0);
    expect(body.failed).toHaveLength(2);
    for (const f of body.failed) expect(f.reason).toBe('Gagal approve, coba lagi');
    expect(JSON.stringify(body)).not.toContain('password');
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('pesan error generik', () => {
  it('approve: error non-ShipmentActionError → ShipmentActionError 500 generik + console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = await approveShipment('S1', actor).catch(e => e);
    expect(err).toBeInstanceOf(ShipmentActionError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Gagal approve, coba lagi');
    expect(spy).toHaveBeenCalled();
  });

  it('reject: sama, pesan generik 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = await rejectShipment('S1', actor, 'alasan').catch(e => e);
    expect(err).toBeInstanceOf(ShipmentActionError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Gagal menolak, coba lagi');
  });

  it('ShipmentActionError tetap diteruskan apa adanya (pesan & status)', async () => {
    h.beginError = new ShipmentActionError('Stok produk tidak cukup', 409);
    const err = await approveShipment('S1', actor).catch(e => e);
    expect(err.message).toBe('Stok produk tidak cukup');
    expect(err.status).toBe(409);
  });
});

describe('tag nota publik', () => {
  it('revalidateShipmentCaches membuang tag nota dengan expire:0 (bukan stale-while-revalidate)', () => {
    revalidateShipmentCaches(['a'], { stock: true });
    expect(revalidateTag).toHaveBeenCalledWith('consignment-shipment-pdf-a', { expire: 0 });
    expect(revalidateTag).not.toHaveBeenCalledWith(expect.anything(), 'max');
    expect(revalidateProductStock).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeEditItems (PUT draft/approved)', () => {
  const ok = { productId: 'P1', productName: 'Keripik', qty: 3, hargaTitip: 5000 };

  it('qty string dipaksa angka, harga dibulatkan, baris ganda digabung (rata-rata tertimbang dibulatkan)', () => {
    const r = normalizeEditItems([{ ...ok, qty: '2' as never, hargaTitip: 1000.4 }, { ...ok, qty: 1, hargaTitip: 2000 }]);
    expect(r).toEqual({ items: [{ productId: 'P1', productName: 'Keripik', qty: 3, hargaTitip: 1333 }] });
  });

  it('item valid tanpa duplikat tidak berubah', () => {
    expect(normalizeEditItems([ok])).toEqual({ items: [ok] });
  });

  it.each([
    ['qty 0', { ...ok, qty: 0 }],
    ['qty negatif', { ...ok, qty: -1 }],
    ['qty NaN', { ...ok, qty: 'abc' as never }],
    ['qty tak hingga', { ...ok, qty: Infinity }],
    ['qty kosong', { ...ok, qty: undefined as never }],
  ])('menolak %s dengan pesan jelas', (_n, it) => {
    const r = normalizeEditItems([it]);
    expect(r).toEqual({ error: 'Jumlah "Keripik" harus berupa angka lebih dari 0.' });
  });

  it('menolak harga negatif/NaN, daftar kosong, dan bukan array', () => {
    expect(normalizeEditItems([{ ...ok, hargaTitip: -5 }])).toHaveProperty('error');
    expect(normalizeEditItems([{ ...ok, hargaTitip: 'x' as never }])).toHaveProperty('error');
    expect(normalizeEditItems([])).toEqual({ error: 'Minimal 1 produk dikirim.' });
    expect(normalizeEditItems(undefined)).toEqual({ error: 'Minimal 1 produk dikirim.' });
  });

  it('mergeItems (POST) tetap: qty Number()||0 dan harga bulat', () => {
    expect(mergeItems([{ ...ok, qty: '4' as never, hargaTitip: 10.6 }])).toEqual([{ ...ok, qty: 4, hargaTitip: 11 }]);
  });
});
