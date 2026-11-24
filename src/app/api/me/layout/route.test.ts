import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  user: { username: 'rifal', role: 'admin' } as { username: string; role: string } | null,
  stale: false as string | null | false,
  queries: [] as unknown[][],
  count: 1,
  dbError: false,
}));

vi.mock('@/lib/admin-auth', () => ({
  getAuthUser: vi.fn(() => h.user),
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/rbac', () => ({
  staleSessionReason: vi.fn(async () => h.stale),
  sessionExpired: (reason?: string | null) => Response.json({ error: reason || 'expired' }, { status: 401 }),
}));
vi.mock('@/lib/db', () => ({
  getSql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (h.dbError) throw new Error('column "ui_layout" does not exist');
    h.queries.push([strings.join('?'), ...values]);
    return Object.assign([], { count: h.count });
  },
}));

import { PUT } from './route';

const req = (body: unknown, raw = false) =>
  ({ json: async () => { if (raw) throw new SyntaxError('bad json'); return body; } }) as unknown as NextRequest;

describe('PUT /api/me/layout', () => {
  beforeEach(() => { h.user = { username: 'rifal', role: 'admin' }; h.stale = false; h.queries = []; h.count = 1; h.dbError = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('tanpa token: 401 dan tidak menyentuh DB', async () => {
    h.user = null;
    expect((await PUT(req({ layout: 'mac' }))).status).toBe(401);
    expect(h.queries).toHaveLength(0);
  });

  it('token sudah dicabut: 401 dan tidak menyentuh DB', async () => {
    h.stale = 'Sesi dicabut';
    const res = await PUT(req({ layout: 'mac' }));
    expect(res.status).toBe(401);
    expect(h.queries).toHaveLength(0);
  });

  it.each(['classic', 'windows', 'mac'])('menyimpan %s untuk username milik token (bukan dari body)', async layout => {
    const res = await PUT(req({ layout, username: 'orang-lain' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, layout });
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0].slice(1)).toEqual([layout, 'rifal']);
  });

  it.each([[{ layout: 'linux' }], [{ layout: '' }], [{ layout: 1 }], [{}], [null]])('nilai tak valid %j: 400 tanpa query', async body => {
    const res = await PUT(req(body));
    expect(res.status).toBe(400);
    expect(h.queries).toHaveLength(0);
  });

  it('body bukan JSON: 400', async () => {
    expect((await PUT(req(null, true))).status).toBe(400);
  });

  it('profil tidak ada: 404', async () => {
    h.count = 0;
    expect((await PUT(req({ layout: 'mac' }))).status).toBe(404);
  });

  it('kolom belum ada / DB error: 500, bukan crash', async () => {
    h.dbError = true;
    expect((await PUT(req({ layout: 'mac' }))).status).toBe(500);
  });
});
