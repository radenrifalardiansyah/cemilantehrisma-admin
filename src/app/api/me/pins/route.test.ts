import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  user: { username: 'rifal', role: 'admin' } as { username: string; role: string } | null,
  stale: false as string | null | false,
  queries: [] as unknown[][],
  count: 1,
  dbError: false,
}));

vi.mock('@/lib/admin-auth', () => ({ getAuthUser: vi.fn(() => h.user), unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) }));
vi.mock('@/lib/rbac', () => ({
  staleSessionReason: vi.fn(async () => h.stale),
  sessionExpired: (reason?: string | null) => Response.json({ error: reason || 'expired' }, { status: 401 }),
}));
vi.mock('@/lib/db', () => ({
  getSql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (h.dbError) throw new Error('column "ui_pins" does not exist');
    h.queries.push([strings.join('?'), ...values]);
    return Object.assign([], { count: h.count });
  },
}));

import { PUT } from './route';

const req = (body: unknown, raw = false) => ({ json: async () => { if (raw) throw new SyntaxError('bad'); return body; } }) as unknown as NextRequest;

describe('PUT /api/me/pins', () => {
  beforeEach(() => { h.user = { username: 'rifal', role: 'admin' }; h.stale = false; h.queries = []; h.count = 1; h.dbError = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('tanpa token: 401 tanpa DB', async () => { h.user = null; expect((await PUT(req({ pins: ['orders'] }))).status).toBe(401); expect(h.queries).toHaveLength(0); });
  it('token dicabut: 401 tanpa DB', async () => { h.stale = 'dicabut'; expect((await PUT(req({ pins: ['orders'] }))).status).toBe(401); expect(h.queries).toHaveLength(0); });

  it('valid: 200, menyimpan array untuk username milik token (bukan dari body)', async () => {
    const res = await PUT(req({ pins: ['orders', 'dashboard'], username: 'orang-lain' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pins: ['orders', 'dashboard'] });
    expect(JSON.parse(h.queries[0][1] as string)).toEqual(['orders', 'dashboard']);
    expect(h.queries[0][2]).toBe('rifal');
  });
  it('daftar kosong valid (pengguna melepas semua)', async () => {
    expect((await PUT(req({ pins: [] }))).status).toBe(200);
    expect(JSON.parse(h.queries[0][1] as string)).toEqual([]);
  });
  it('null = kembali ke bawaan: menulis null', async () => {
    const res = await PUT(req({ pins: null }));
    expect(res.status).toBe(200);
    expect(h.queries[0][1]).toBeNull();
  });

  it.each([
    [{ pins: 'orders' }], [{ pins: ['bukan-tab'] }], [{ pins: ['orders', 'orders'] }], [{ pins: ['orders', 3] }], [{ pins: { 0: 'orders' } }],
    [{ pins: Array.from({ length: 41 }, (_, i) => `x${i}`) }], [{}], [null],
  ])('tidak valid %j: 400 tanpa query', async body => {
    expect((await PUT(req(body))).status).toBe(400);
    expect(h.queries).toHaveLength(0);
  });
  it('body bukan JSON: 400', async () => { expect((await PUT(req(null, true))).status).toBe(400); });
  it('profil tidak ada: 404', async () => { h.count = 0; expect((await PUT(req({ pins: ['orders'] }))).status).toBe(404); });
  it('kolom belum ada / DB error: 500', async () => { h.dbError = true; expect((await PUT(req({ pins: ['orders'] }))).status).toBe(500); });
});
