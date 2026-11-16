import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Tes tautan PDF Daftar Belanja: kode HMAC ringkas, rute publik /b/[code] (bot/HEAD ringan, 404), endpoint pdf-link.

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], settings: {} as Record<string, unknown>, perm: true, render: 0 }));

vi.mock('@/lib/db', () => ({ getSql: () => (() => Promise.resolve(h.rows)) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(async () => h.perm ? { username: 'rifal', role: 'admin' } : Response.json({ error: 'Forbidden' }, { status: 403 })),
}));
vi.mock('@/lib/settings-pg', () => ({ getSettings: async () => h.settings }));
vi.mock('@/lib/pdf/server-store-header', () => ({ getServerStoreHeader: async () => ({ name: 'Toko' }) }));
vi.mock('@react-pdf/renderer', async importOriginal => ({
  ...(await importOriginal<typeof import('@react-pdf/renderer')>()),
  renderToBuffer: vi.fn(async () => { h.render++; return Buffer.from('%PDF-fake'); }),
}));

import { resetRateLimits } from './rate-limit';
import { buildShoppingPdfUrl, parseShoppingShortCode, signShoppingShortCode, supplierHashOf } from './shopping-pdf-link';
import { GET as pdfGet, HEAD as pdfHead } from '@/app/b/[code]/route';
import { POST as linkRoute } from '@/app/api/material-shopping/pdf-link/route';

const SUP = supplierHashOf({ supplierId: 'sup-1', supplierName: 'UD Tani' });
const row = (o: Record<string, unknown> = {}) => ({
  id: 'i1', material_id: 'm1', material_name: 'Gula', material_unit: 'kg', qty: '2', price: '15000', note: null,
  shopping_date: '2026-11-16', supplier_id: 'sup-1', supplier_name: 'UD Tani', checked: false, status: 'pending',
  purchase_id: null, created_by: 'rifal', created_at: new Date('2026-11-15T01:00:00Z'), done_at: null, name: 'Kas', ...o,
});

const OLD = process.env.JWT_SECRET;
beforeEach(() => { resetRateLimits(); process.env.JWT_SECRET = 'test-secret'; h.rows = [row()]; h.settings = { whatsapp: '081234567890' }; h.perm = true; h.render = 0; });
afterEach(() => { if (OLD === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = OLD; });

const req = (code: string, ua?: string) => new NextRequest(`http://x/b/${code}`, { headers: ua ? { 'user-agent': ua } : {} });
const ctx = (code: string) => ({ params: Promise.resolve({ code }) });
const flip = (c: string) => (c === 'A' ? 'B' : 'A');

describe('kode ringkas /b/<kode>', () => {
  it('panjang: gabungan 20, per supplier 31; roundtrip', () => {
    const day = signShoppingShortCode({ date: '2026-11-16', supplierHash: null })!;
    const sup = signShoppingShortCode({ date: '2026-11-16', supplierHash: SUP })!;
    expect(day).toHaveLength(20);
    expect(sup).toHaveLength(31);
    expect(day).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseShoppingShortCode(day)).toEqual({ date: '2026-11-16', supplierHash: null });
    const p = parseShoppingShortCode(sup)!;
    expect(p.date).toBe('2026-11-16');
    expect(p.supplierHash!.equals(SUP)).toBe(true);
    expect(buildShoppingPdfUrl('https://h.test', { date: '2026-11-16', supplierHash: SUP })).toBe(`https://h.test/b/${sup}`);
  });
  it('supplier berbeda / tanggal berbeda → kode berbeda; nama dinormalisasi seperti panel', () => {
    const a = signShoppingShortCode({ date: '2026-11-16', supplierHash: SUP });
    const b = signShoppingShortCode({ date: '2026-11-16', supplierHash: supplierHashOf({ supplierName: 'Warung Ani' }) });
    const c = signShoppingShortCode({ date: '2026-11-17', supplierHash: SUP });
    expect(new Set([a, b, c]).size).toBe(3);
    expect(supplierHashOf({ supplierName: '  Warung ANI ' }).equals(supplierHashOf({ supplierName: 'warung ani' }))).toBe(true);
    expect(supplierHashOf({ supplierId: 'x', supplierName: 'A' }).equals(supplierHashOf({ supplierId: 'x', supplierName: 'B' }))).toBe(true);
  });
  it('tanda tangan / muatan diubah, panjang salah, karakter ilegal → null', () => {
    const code = signShoppingShortCode({ date: '2026-11-16', supplierHash: SUP })!;
    expect(parseShoppingShortCode(code.slice(0, 30) + flip(code[30]))).toBeNull();
    expect(parseShoppingShortCode(flip(code[0]) + code.slice(1))).toBeNull();
    expect(parseShoppingShortCode(code.slice(0, 30))).toBeNull();
    expect(parseShoppingShortCode(code + 'A')).toBeNull();
    expect(parseShoppingShortCode('!'.repeat(20))).toBeNull();
    expect(parseShoppingShortCode('')).toBeNull();
    expect(parseShoppingShortCode(null)).toBeNull();
  });
  it('kode gabungan tidak bisa dipakai sebagai kode supplier (domain tanda tangan berbeda per muatan)', () => {
    const day = signShoppingShortCode({ date: '2026-11-16', supplierHash: null })!;
    expect(parseShoppingShortCode(day + 'AAAAAAAAAAA')).toBeNull();
  });
  it('tanggal tidak valid → null; rahasia beda / tanpa JWT_SECRET gagal tertutup', () => {
    expect(signShoppingShortCode({ date: '2026-02-31', supplierHash: null })).toBeNull();
    expect(signShoppingShortCode({ date: 'bukan', supplierHash: null })).toBeNull();
    const code = signShoppingShortCode({ date: '2026-11-16', supplierHash: null })!;
    process.env.JWT_SECRET = 'rahasia-lain';
    expect(parseShoppingShortCode(code)).toBeNull();
    delete process.env.JWT_SECRET;
    expect(signShoppingShortCode({ date: '2026-11-16', supplierHash: null })).toBeNull();
    expect(parseShoppingShortCode(code)).toBeNull();
    expect(buildShoppingPdfUrl('https://h.test', { date: '2026-11-16', supplierHash: null })).toBeNull();
  });
});

describe('rute /b/[code]', () => {
  const code = () => signShoppingShortCode({ date: '2026-11-16', supplierHash: SUP })!;
  it('GET → 200 PDF no-store (render sekali)', async () => {
    const res = await pdfGet(req(code()), ctx(code()));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(h.render).toBe(1);
  });
  it('HEAD dan crawler pratinjau tidak merender', async () => {
    const head = await pdfHead(req(code()), ctx(code()));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const bot = await pdfGet(req(code(), 'WhatsApp/2.23 A'), ctx(code()));
    expect(bot.status).toBe(200);
    expect(bot.headers.get('Content-Type')).toContain('text/html');
    expect(h.render).toBe(0);
  });
  it('kode salah, daftar kosong/supplier lain → 404 tanpa render', async () => {
    expect((await pdfGet(req('x'.repeat(31)), ctx('x'.repeat(31)))).status).toBe(404);
    h.rows = [];
    expect((await pdfGet(req(code()), ctx(code()))).status).toBe(404);
    h.rows = [row({ supplier_id: 'sup-2', supplier_name: 'Lain' })];
    expect((await pdfGet(req(code()), ctx(code()))).status).toBe(404);
    expect(h.render).toBe(0);
  });
  it('gabungan: semua supplier ikut; rate limit → 429', async () => {
    h.rows = [row(), row({ supplier_id: null, supplier_name: 'Warung Ani' })];
    const day = signShoppingShortCode({ date: '2026-11-16', supplierHash: null })!;
    expect((await pdfGet(req(day), ctx(day))).status).toBe(200);
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await pdfHead(req(day), ctx(day))).status;
    expect(last).toBe(429);
  });
});

describe('POST /api/material-shopping/pdf-link', () => {
  const call = (body: unknown) => linkRoute(new NextRequest('http://admin.test/api/material-shopping/pdf-link', { method: 'POST', body: JSON.stringify(body) }));
  it('per supplier: url /b/<kode> + nomor toko ternormalisasi', async () => {
    const res = await call({ date: '2026-11-16', supplierId: 'sup-1', supplierName: 'UD Tani' });
    expect(res.status).toBe(200);
    const d = await res.json() as { url: string; phone: string };
    expect(d.url).toBe(`http://admin.test/b/${signShoppingShortCode({ date: '2026-11-16', supplierHash: SUP })}`);
    expect(d.phone).toBe('6281234567890');
  });
  it('gabungan; nomor toko kosong/tidak valid → phone kosong', async () => {
    h.settings = {};
    const d = await (await call({ date: '2026-11-16', allSuppliers: true })).json() as { url: string; phone: string };
    expect(d.url).toBe(`http://admin.test/b/${signShoppingShortCode({ date: '2026-11-16', supplierHash: null })}`);
    expect(d.phone).toBe('');
  });
  it('izin ditolak → 403; tanggal salah → 400; daftar tidak ada → 404', async () => {
    h.perm = false;
    expect((await call({ date: '2026-11-16', allSuppliers: true })).status).toBe(403);
    h.perm = true;
    expect((await call({ date: 'x', allSuppliers: true })).status).toBe(400);
    h.rows = [];
    expect((await call({ date: '2026-11-16', allSuppliers: true })).status).toBe(404);
  });
});
