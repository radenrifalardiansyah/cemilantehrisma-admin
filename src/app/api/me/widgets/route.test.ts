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
    if (h.dbError) throw new Error('column "ui_widgets" does not exist');
    h.queries.push([strings.join('?'), ...values]);
    return Object.assign([], { count: h.count });
  },
}));

import { PUT } from './route';

const req = (body: unknown, raw = false) => ({ json: async () => { if (raw) throw new SyntaxError('bad'); return body; } }) as unknown as NextRequest;
const clock = { id: 'abcd1234', type: 'clock', col: 0, row: 0, size: 's', config: {} };
const note = { id: 'efgh5678', type: 'note', col: 2, row: 0, size: 'm', config: { text: 'beli gula' } };

describe('PUT /api/me/widgets', () => {
  beforeEach(() => { h.user = { username: 'rifal', role: 'admin' }; h.stale = false; h.queries = []; h.count = 1; h.dbError = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('tanpa token: 401 tanpa DB', async () => { h.user = null; expect((await PUT(req({ widgets: [clock] }))).status).toBe(401); expect(h.queries).toHaveLength(0); });
  it('token dicabut: 401 tanpa DB', async () => { h.stale = 'dicabut'; expect((await PUT(req({ widgets: [clock] }))).status).toBe(401); expect(h.queries).toHaveLength(0); });

  it('valid: 200, menyimpan untuk username milik token (bukan dari body)', async () => {
    const res = await PUT(req({ widgets: [clock, note], username: 'orang-lain' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, widgets: [clock, note] });
    expect(JSON.parse(h.queries[0][1] as string)).toEqual([clock, note]);
    expect(h.queries[0][2]).toBe('rifal');
  });
  it('config boleh dihilangkan; [] valid; null menulis null', async () => {
    const { config: _c, ...bare } = clock; void _c;
    expect((await PUT(req({ widgets: [bare] }))).status).toBe(200);
    expect(JSON.parse(h.queries[0][1] as string)).toEqual([bare]);
    expect((await PUT(req({ widgets: [] }))).status).toBe(200);
    expect(JSON.parse(h.queries[1][1] as string)).toEqual([]);
    expect((await PUT(req({ widgets: null }))).status).toBe(200);
    expect(h.queries[2][1]).toBeNull();
  });
  it('clock config {format} valid', async () => {
    expect((await PUT(req({ widgets: [{ ...clock, config: { format: 'hms' } }] }))).status).toBe(200);
  });

  const many = Array.from({ length: 13 }, (_, i) => ({ ...clock, id: `w${i}` }));
  it.each([
    ['bukan array', { widgets: 'x' }], ['objek', { widgets: { 0: clock } }], ['tanpa field widgets', {}], ['body null', null],
    ['13 widget', { widgets: many }],
    ['item bukan objek', { widgets: [3] }], ['item array', { widgets: [[]] }],
    ['id duplikat', { widgets: [clock, { ...note, id: clock.id }] }],
    ['id kosong', { widgets: [{ ...clock, id: '' }] }], ['id bukan string', { widgets: [{ ...clock, id: 5 }] }], ['id aneh', { widgets: [{ ...clock, id: 'a b/c' }] }],
    ['type tak dikenal', { widgets: [{ ...clock, type: 'bukan' }] }], ['type prototipe', { widgets: [{ ...clock, type: 'toString' }] }], ['type konstruktor', { widgets: [{ ...clock, type: '__proto__' }] }],
    ['size salah', { widgets: [{ ...clock, size: 'xl' }] }], ['size tak diizinkan type (clock l)', { widgets: [{ ...clock, size: 'l' }] }], ['size tak diizinkan type (note s)', { widgets: [{ ...note, size: 's' }] }],
    ['col negatif', { widgets: [{ ...clock, col: -1 }] }], ['col pecahan', { widgets: [{ ...clock, col: 1.5 }] }], ['col 40', { widgets: [{ ...clock, col: 40 }] }], ['row string', { widgets: [{ ...clock, row: '0' }] }], ['row NaN', { widgets: [{ ...clock, row: null }] }],
    ['field asing', { widgets: [{ ...clock, extra: 1 }] }],
    ['config array', { widgets: [{ ...clock, config: [] }] }], ['config null', { widgets: [{ ...clock, config: null }] }], ['config kunci asing clock', { widgets: [{ ...clock, config: { x: 1 } }] }],
    ['clock format salah', { widgets: [{ ...clock, config: { format: 'abc' } }] }],
    ['note text bukan string', { widgets: [{ ...note, config: { text: 5 } }] }], ['note text 501 karakter', { widgets: [{ ...note, config: { text: 'a'.repeat(501) } }] }],
    ['note kunci asing', { widgets: [{ ...note, config: { text: 'a', y: 1 } }] }], ['note config bersarang', { widgets: [{ ...note, config: { text: { a: 1 } } }] }],
    ['note karakter kontrol', { widgets: [{ ...note, config: { text: 'a\u0000b' } }] }],
  ])('tidak valid (%s): 400 tanpa query', async (_n, body) => {
    expect((await PUT(req(body))).status).toBe(400);
    expect(h.queries).toHaveLength(0);
  });
  it('__proto__ sebagai kunci (dari JSON.parse) ditolak', async () => {
    const evil = JSON.parse('{"id":"abcd1234","type":"note","col":0,"row":0,"size":"m","config":{"__proto__":{"x":1}}}');
    expect((await PUT(req({ widgets: [evil] }))).status).toBe(400);
    const evil2 = JSON.parse('{"id":"abcd1234","type":"note","col":0,"row":0,"size":"m","__proto__":{"x":1}}');
    expect((await PUT(req({ widgets: [evil2] }))).status).toBe(400);
  });
  it('catatan 500 karakter (batas) valid, termasuk baris baru', async () => {
    expect((await PUT(req({ widgets: [{ ...note, config: { text: 'a\n'.repeat(250) } }] }))).status).toBe(200);
  });
  it('body bukan JSON: 400', async () => { expect((await PUT(req(null, true))).status).toBe(400); });
  it('profil tidak ada: 404', async () => { h.count = 0; expect((await PUT(req({ widgets: [clock] }))).status).toBe(404); });
  it('kolom belum ada / DB error: 500', async () => { h.dbError = true; expect((await PUT(req({ widgets: [clock] }))).status).toBe(500); });
});
