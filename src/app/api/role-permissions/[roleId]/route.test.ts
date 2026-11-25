import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  guard: { username: 'rifal', role: 'admin' } as { username: string; role: string } | Response,
  roleExists: true,
  queries: [] as string[],
  revalidated: 0,
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(async () => h.guard),
  ROLE_PERMISSIONS_TAG: 'role-permissions',
}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(() => { h.revalidated++; }) }));
vi.mock('@/lib/db', () => ({
  getSql: () => async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    h.queries.push(text.trim().split(/\s+/)[0]);
    if (text.includes('from roles')) return h.roleExists ? [{ id: 'kasir' }] : [];
    return [];
  },
}));

import { PUT } from './route';

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const ctx = (roleId: string) => ({ params: Promise.resolve({ roleId }) });
const perms = { permissions: { orders: { view: true } } };

describe('PUT /api/role-permissions/[roleId]', () => {
  beforeEach(() => { h.guard = { username: 'rifal', role: 'admin' }; h.roleExists = true; h.queries = []; h.revalidated = 0; });

  it('role tidak ada: 404 tanpa menulis apa pun dan tanpa revalidate', async () => {
    h.roleExists = false;
    const res = await PUT(req(perms), ctx('hantu'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Role tidak ditemukan.' });
    expect(h.queries).toEqual(['select']);
    expect(h.revalidated).toBe(0);
  });

  it('role ada: perilaku lama (upsert + revalidate, 200)', async () => {
    const res = await PUT(req(perms), ctx('kasir'));
    expect(res.status).toBe(200);
    expect(h.queries).toEqual(['select', 'insert']);
    expect(h.revalidated).toBe(1);
  });

  it('super-admin tetap 400 (sebelum cek role) dan role sendiri tetap ditolak', async () => {
    expect((await PUT(req(perms), ctx('super-admin'))).status).toBe(400);
    expect((await PUT(req(perms), ctx('admin'))).status).toBe(400);
    expect(h.queries).toEqual([]);
  });

  it('tanpa izin: respons guard diteruskan tanpa menyentuh DB', async () => {
    h.guard = Response.json({ error: 'Forbidden' }, { status: 403 });
    expect((await PUT(req(perms), ctx('kasir'))).status).toBe(403);
    expect(h.queries).toEqual([]);
  });

  it('permissions tidak valid: 400 sebelum DB', async () => {
    expect((await PUT(req({}), ctx('kasir'))).status).toBe(400);
    expect(h.queries).toEqual([]);
  });
});
