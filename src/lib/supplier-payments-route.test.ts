import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes rute GET /api/material-purchases/payments dengan "Postgres" palsu: mengembalikan baris yang sudah disiapkan dan
// mencatat parameter query. BUKAN uji SQL sungguhan (join, filter, urutan di Postgres tidak teruji di sini).
const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: [] as unknown[][], fail: false, denied: false }));

vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getSql: () => (_s: unknown, ...v: unknown[]) => { h.calls.push(v); return h.fail ? Promise.reject(new Error('db')) : Promise.resolve(h.rows); },
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => (h.denied ? Response.json({ error: 'x' }, { status: 403 }) : { username: 'rifal', role: 'admin' })) }));

import { GET } from '@/app/api/material-purchases/payments/route';

const dbRow = (o: Record<string, unknown> = {}) => ({
  id: 'x1', purchase_id: 'p1', date: '2026-11-10', amount: '100000.00', supplier_id: 's1', supplier_name: 'Toko A', po_number: 'PO-1', gr_number: null,
  wallet_id: 'kas', wallet_name: 'Kas', note: null, created_by: 'rifal', voided: false, purchase_voided: false, created_at: new Date('2026-11-10T01:00:00Z'), ...o,
});
const get = (qs = '') => GET(new NextRequest(`http://x/api/material-purchases/payments${qs}`));

beforeEach(() => { h.rows = []; h.calls = []; h.fail = false; h.denied = false; });

describe('GET /api/material-purchases/payments', () => {
  it('memetakan baris, ringkasan tanpa yang void, parameter filter diteruskan', async () => {
    h.rows = [dbRow(), dbRow({ id: 'x2', amount: '50000', voided: true }), dbRow({ id: 'x3', amount: '25000', purchase_voided: true, supplier_id: 's2' })];
    const res = await get('?from=2026-11-01&to=2026-11-30&supplierId=s1&includeVoided=true');
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.truncated).toBe(false);
    expect(d.payments[0]).toMatchObject({ id: 'x1', amount: 100000, supplierName: 'Toko A', poNumber: 'PO-1', walletName: 'Kas', note: '', voided: false, createdAt: '2026-11-10T01:00:00.000Z' });
    expect(d.payments[2]).toMatchObject({ voided: true, purchaseVoided: true });
    expect(d.summary).toEqual({ count: 1, totalPaid: 100000, supplierCount: 1, voidedCount: 2 });
    expect(h.calls[0].slice(0, 5)).toEqual(['2026-11-01', '2026-11-01', '2026-11-30', '2026-11-30', 's1']);
    expect(h.calls[0]).toContain(true);
  });
  it('default: tanpa filter, includeVoided false, limit 1001 diminta', async () => {
    await get();
    expect(h.calls[0].slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(h.calls[0]).toContain(false);
    expect(h.calls[0][h.calls[0].length - 1]).toBe(1001);
  });
  it('truncated bila hasil melebihi batas, dan hanya 1000 dikembalikan', async () => {
    h.rows = Array.from({ length: 1001 }, (_, i) => dbRow({ id: `x${i}` }));
    const d = await (await get()).json();
    expect(d.truncated).toBe(true);
    expect(d.payments).toHaveLength(1000);
  });
  it('validasi tanggal: format salah dan from > to ditolak', async () => {
    expect((await get('?from=13-11-2026')).status).toBe(400);
    expect((await get('?to=2026-02-30')).status).toBe(400);
    expect((await get('?from=2026-11-10&to=2026-11-01')).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
  it('izin ditolak dan error DB', async () => {
    h.denied = true;
    expect((await get()).status).toBe(403);
    h.denied = false; h.fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await get()).status).toBe(500);
  });
});
