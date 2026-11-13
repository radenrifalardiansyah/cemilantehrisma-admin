import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';

// Tes biaya akses PDF publik closing: cache server, 404 tetap seketika, invalidasi reopen, crawler/HEAD, rate limit.

const h = vi.hoisted(() => ({
  closing: null as unknown,
  queries: 0,
  store: new Map<string, { value: unknown; tags: string[] }>(),
  revalidated: [] as string[],
  reopenResult: { id: 'x', periodTo: '2026-11-13', released: 3 },
}));

vi.mock('@/lib/db', () => ({ getSql: () => (() => { h.queries++; return Promise.resolve(h.closing ? [h.closing] : []); }) }));
// unstable_cache in-memory: hit bila kunci ada; lemparan tidak disimpan; revalidateTag membuang entri bertag.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>, keyParts: string[], opts: { tags?: string[] } = {}) => async (...args: unknown[]) => {
    const key = JSON.stringify([keyParts, args]);
    const hit = h.store.get(key);
    if (hit) return hit.value;
    const value = await fn(...args);
    h.store.set(key, { value, tags: opts.tags ?? [] });
    return value;
  },
  revalidateTag: (tag: string) => { h.revalidated.push(tag); for (const [k, v] of h.store) if (v.tags.includes(tag)) h.store.delete(k); },
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => ({ username: 'rifal', role: 'admin' })) }));
vi.mock('@/lib/firebase-admin', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/history', () => ({ logHistory: vi.fn(async () => undefined) }));
vi.mock('@/lib/closing', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/closing')>()),
  loadClosingLines: vi.fn(async () => []),
  reopenClosing: vi.fn(async () => h.reopenResult),
}));
vi.mock('@/lib/pdf/server-store-header', () => ({ getServerStoreHeader: async () => ({ name: 'Toko' }) }));
vi.mock('@react-pdf/renderer', async importOriginal => ({ ...(await importOriginal<typeof import('@react-pdf/renderer')>()), renderToBuffer: vi.fn(async () => Buffer.from('%PDF-fake')) }));

import { closingPdfTag, signClosingPdfToken } from './closing-wa';
import { CLOSING_PDF_MAX_BYTES } from './pdf/closing-pdf-server';
import { resetRateLimits } from './rate-limit';
import type { ClosingRecord } from './pdf/closing-pdf-data';
import { GET as publicGet, HEAD as publicHead } from '@/app/api/closings/[id]/pdf/public/route';
import { GET as authGet } from '@/app/api/closings/[id]/pdf/route';
import { POST as reopenPost } from '@/app/api/closings/[id]/reopen/route';

const ID = 'abcdef12-0000-0000-0000-000000000000';
const ctx = { params: Promise.resolve({ id: ID }) };
const rec = (over: Partial<ClosingRecord> = {}): ClosingRecord => ({
  id: ID, period_from: '2026-11-12', period_to: '2026-11-13', closed_at: new Date('2026-11-13T02:14:00Z'), closed_by: 'su',
  total_qty: '20', total_cogs: '118750', total_revenue: '171000', item_count: 9, note: null,
  status: 'aktif', reopened_at: null, reopened_by: null, reopen_reason: null, is_opening_balance: false, ...over,
});
const req = (o: { ua?: string; ip?: string; token?: string | null; method?: string } = {}) => {
  const t = o.token === undefined ? signClosingPdfToken(ID) : o.token;
  const headers: Record<string, string> = { 'x-forwarded-for': o.ip ?? '1.1.1.1' };
  if (o.ua) headers['user-agent'] = o.ua;
  return new NextRequest(`http://x/api/closings/${ID}/pdf/public${t ? `?t=${t}` : ''}`, { method: o.method ?? 'GET', headers });
};
const renders = () => vi.mocked(renderToBuffer).mock.calls.length;

const OLD = process.env.JWT_SECRET;
beforeEach(() => {
  process.env.JWT_SECRET = OLD ?? 'test-secret';
  process.env.JWT_SECRET = 'test-secret';
  h.closing = rec(); h.queries = 0; h.store.clear(); h.revalidated = [];
  vi.mocked(renderToBuffer).mockClear();
  vi.mocked(renderToBuffer).mockImplementation(async () => Buffer.from('%PDF-fake'));
  resetRateLimits();
});

describe('cache render PDF publik', () => {
  it('hit kedua tidak merender ulang, isi sama, tetap no-store', async () => {
    const a = await publicGet(req(), ctx);
    const b = await publicGet(req(), ctx);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(renders()).toBe(1);
    expect(Buffer.from(await b.arrayBuffer()).toString()).toBe('%PDF-fake');
    expect(b.headers.get('Cache-Control')).toBe('private, no-store');
    expect(h.store.has(JSON.stringify([['closing-pdf', ID], []]))).toBe(true);
  });
  it('cache hit hanya 1 query (status); miss = status + closing + (lines dimock)', async () => {
    await publicGet(req(), ctx);
    const miss = h.queries;
    h.queries = 0;
    await publicGet(req(), ctx);
    expect(h.queries).toBe(1);
    expect(miss).toBeGreaterThan(1);
  });
  it('dibuka_ulang tetap 404 walau cache masih ada (cek status di luar cache)', async () => {
    await publicGet(req(), ctx);
    expect(h.store.size).toBe(1);
    h.closing = rec({ status: 'dibuka_ulang' });
    const res = await publicGet(req(), ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(renders()).toBe(1);
  });
  it('PDF melebihi batas tidak di-cache tetapi tetap disajikan (render sekali per hit)', async () => {
    vi.mocked(renderToBuffer).mockImplementation(async () => Buffer.alloc(CLOSING_PDF_MAX_BYTES + 1, 1));
    const a = await publicGet(req(), ctx);
    expect(a.status).toBe(200);
    expect((await a.arrayBuffer()).byteLength).toBe(CLOSING_PDF_MAX_BYTES + 1);
    expect(h.store.size).toBe(0);
    await publicGet(req(), ctx);
    expect(renders()).toBe(2);
  });
  it('rute terautentikasi memakai cache yang sama untuk closing aktif; non-aktif dirender langsung', async () => {
    const r = { method: 'GET' } as never;
    await publicGet(req(), ctx);
    const res = await authGet(new NextRequest(`http://x/api/closings/${ID}/pdf`, r), ctx);
    expect(res.status).toBe(200);
    expect(renders()).toBe(1);
    h.closing = rec({ status: 'dibuka_ulang' });
    const res2 = await authGet(new NextRequest(`http://x/api/closings/${ID}/pdf`, r), ctx);
    expect(res2.status).toBe(200); // perilaku lama: rute admin tetap bisa melihat
    expect(renders()).toBe(2);
    h.closing = null;
    expect((await authGet(new NextRequest(`http://x/api/closings/${ID}/pdf`, r), ctx)).status).toBe(404);
  });
});

describe('invalidasi', () => {
  it('reopen membuang tag closing-pdf:{id} sehingga render berikutnya (bila aktif lagi) fresh', async () => {
    await publicGet(req(), ctx);
    expect(h.store.size).toBe(1);
    const res = await reopenPost(new NextRequest(`http://x/api/closings/${ID}/reopen`, { method: 'POST', body: JSON.stringify({ reason: 'koreksi' }) }), ctx);
    expect(res.status).toBe(200);
    expect(h.revalidated).toContain(closingPdfTag(ID));
    expect(h.store.size).toBe(0);
  });
});

describe('crawler & HEAD tidak merender', () => {
  it.each(['WhatsApp/2.23.20.0 A', 'facebookexternalhit/1.1', 'TelegramBot (like TwitterBot)', 'Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)'])(
    'UA %s → 200 ringan tanpa render/cache', async ua => {
      const res = await publicGet(req({ ua }), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      expect(renders()).toBe(0);
      expect(h.store.size).toBe(0);
      expect(h.queries).toBe(1);
    });
  it('HEAD → 200 tanpa body & tanpa render', async () => {
    const res = await publicHead(req({ method: 'HEAD' }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await res.text()).toBe('');
    expect(renders()).toBe(0);
  });
  it('token salah tetap 404 untuk crawler & HEAD, tanpa query DB', async () => {
    expect((await publicGet(req({ ua: 'WhatsApp/2', token: 'salah' }), ctx)).status).toBe(404);
    expect((await publicHead(req({ method: 'HEAD', token: 'salah' }), ctx)).status).toBe(404);
    expect(h.queries).toBe(0);
  });
  it('crawler/HEAD pada closing dibuka_ulang → 404', async () => {
    h.closing = rec({ status: 'dibuka_ulang' });
    expect((await publicGet(req({ ua: 'WhatsApp/2' }), ctx)).status).toBe(404);
    expect((await publicHead(req({ method: 'HEAD' }), ctx)).status).toBe(404);
  });
});

describe('rate limit', () => {
  it('lewat batas → 429 + Retry-After tanpa query DB; IP lain tidak terdampak', async () => {
    for (let i = 0; i < 20; i++) expect((await publicGet(req(), ctx)).status).toBe(200);
    h.queries = 0;
    const res = await publicGet(req(), ctx);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(h.queries).toBe(0);
    expect((await publicGet(req({ ip: '2.2.2.2' }), ctx)).status).toBe(200);
  });
  it('token salah tidak menghabiskan kuota dan tetap 404', async () => {
    for (let i = 0; i < 30; i++) expect((await publicGet(req({ token: 'salah' }), ctx)).status).toBe(404);
    expect((await publicGet(req(), ctx)).status).toBe(200);
  });
});
