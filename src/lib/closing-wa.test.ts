import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Tes Kirim WA Closing HPP: pesan, token HMAC, rute publik (404), dan rute /wa.

const h = vi.hoisted(() => ({ closing: null as unknown, settings: {} as Record<string, unknown>, lines: [] as unknown[], perm: true }));

vi.mock('@/lib/db', () => ({ getSql: () => (() => Promise.resolve(h.closing ? [h.closing] : [])) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(async () => h.perm ? { username: 'rifal', role: 'admin' } : Response.json({ error: 'Forbidden' }, { status: 403 })),
}));
vi.mock('@/lib/settings-pg', () => ({ getSettings: async () => h.settings }));
vi.mock('@/lib/closing', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/closing')>()), loadClosingLines: vi.fn(async () => h.lines) }));
vi.mock('@/lib/pdf/server-store-header', () => ({ getServerStoreHeader: async () => ({ name: 'Toko' }) }));
vi.mock('@react-pdf/renderer', async importOriginal => ({ ...(await importOriginal<typeof import('@react-pdf/renderer')>()), renderToBuffer: vi.fn(async () => Buffer.from('%PDF-fake')) }));

import { resetRateLimits } from './rate-limit';
import { buildClosingWaMessage, periodLabel, signClosingPdfToken, verifyClosingPdfToken } from './closing-wa';
import { formatRp } from './format';
import type { ClosingRecord } from './pdf/closing-pdf-data';
import { GET as publicPdf } from '@/app/api/closings/[id]/pdf/public/route';
import { POST as waRoute } from '@/app/api/closings/[id]/wa/route';

const ID = 'abcdef12-0000-0000-0000-000000000000';
const rec = (over: Partial<ClosingRecord> = {}): ClosingRecord => ({
  id: ID, period_from: '2026-11-12', period_to: '2026-11-13', closed_at: new Date('2026-11-13T02:14:00Z'), closed_by: 'superadmin',
  total_qty: '20', total_cogs: '118750', total_revenue: '171000', item_count: 9, note: null,
  status: 'aktif', reopened_at: null, reopened_by: null, reopen_reason: null, is_opening_balance: false, ...over,
});

const OLD = process.env.JWT_SECRET;
beforeEach(() => { resetRateLimits(); process.env.JWT_SECRET = 'test-secret'; h.closing = rec(); h.settings = { storeName: 'Cemilan Teh Risma', whatsapp: '081234567890' }; h.lines = []; h.perm = true; });
afterEach(() => { if (OLD === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = OLD; });

describe('periodLabel', () => {
  it('satu tanggal bila sama atau tanpa awal', () => {
    expect(periodLabel('2026-11-13', '2026-11-13')).toBe('13 Nov 2026');
    expect(periodLabel(null, '2026-11-13')).toBe('13 Nov 2026');
  });
  it('rentang: bulan sama, bulan beda, tahun beda', () => {
    expect(periodLabel('2026-11-12', '2026-11-13')).toBe('12 – 13 Nov 2026');
    expect(periodLabel('2026-10-30', '2026-11-02')).toBe('30 Okt – 2 Nov 2026');
    expect(periodLabel('2025-12-30', '2026-01-02')).toBe('30 Des 2025 – 2 Jan 2026');
  });
});

describe('buildClosingWaMessage', () => {
  it('versi lengkap tanpa baris sudah ditransfer / sisa', () => {
    const msg = buildClosingWaMessage(rec(), { storeName: 'Cemilan Teh Risma', pdfUrl: 'https://x/p?t=abc' });
    expect(msg).toBe([
      '*CLOSING HPP — Cemilan Teh Risma*',
      'Ditutup: 13 Nov 2026, 09.14 oleh superadmin',
      '',
      'Periode   : 12 – 13 Nov 2026',
      'Transaksi : 9',
      `Omzet     : ${formatRp(171000)}`,
      `*HPP      : ${formatRp(118750)}*`,
      'Terbilang : Seratus Delapan Belas Ribu Tujuh Ratus Lima Puluh Rupiah',
      '',
      'Mohon dicek dan ditransfer. Terima kasih 🙏',
      'Rincian (PDF): https://x/p?t=abc',
    ].join('\n'));
    expect(msg).not.toContain('Sudah ditransfer');
    expect(msg).not.toContain('Sisa');
  });
  it('periode satu tanggal, fallback nama toko & pembuat', () => {
    const msg = buildClosingWaMessage(rec({ period_from: '2026-11-13', closed_by: null }), { storeName: '  ', pdfUrl: 'u' });
    expect(msg).toContain('*CLOSING HPP — Cemilan Teh Risma*');
    expect(msg).toContain('Periode   : 13 Nov 2026');
    expect(msg).toContain('oleh –');
  });
});

describe('token PDF publik', () => {
  it('valid; salah; id lain; kosong', () => {
    const t = signClosingPdfToken(ID);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyClosingPdfToken(ID, t)).toBe(true);
    expect(verifyClosingPdfToken(ID, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(verifyClosingPdfToken('id-lain', t)).toBe(false);
    expect(verifyClosingPdfToken(ID, '')).toBe(false);
    expect(verifyClosingPdfToken(ID, null)).toBe(false);
    expect(verifyClosingPdfToken(ID, 'pendek')).toBe(false); // panjang beda tidak melempar (timingSafeEqual)
  });
  it('rahasia berbeda → token tidak berlaku; tanpa JWT_SECRET gagal tertutup', () => {
    const t = signClosingPdfToken(ID);
    process.env.JWT_SECRET = 'lain';
    expect(verifyClosingPdfToken(ID, t)).toBe(false);
    delete process.env.JWT_SECRET;
    expect(verifyClosingPdfToken(ID, t)).toBe(false);
    expect(() => signClosingPdfToken(ID)).toThrow();
  });
});

const pubReq = (t?: string) => new NextRequest(`http://x/api/closings/${ID}/pdf/public${t ? `?t=${t}` : ''}`);
const ctx = { params: Promise.resolve({ id: ID }) };

describe('GET /api/closings/[id]/pdf/public', () => {
  it('aktif + token valid → 200 PDF, no-store', async () => {
    const res = await publicPdf(pubReq(signClosingPdfToken(ID)), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('tanpa token / token salah → 404', async () => {
    expect((await publicPdf(pubReq(), ctx)).status).toBe(404);
    expect((await publicPdf(pubReq('salah'), ctx)).status).toBe(404);
  });
  it('dibuka_ulang → 404', async () => {
    h.closing = rec({ status: 'dibuka_ulang' });
    const res = await publicPdf(pubReq(signClosingPdfToken(ID)), ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('saldo awal → 404; closing tidak ada → 404', async () => {
    h.closing = rec({ is_opening_balance: true });
    expect((await publicPdf(pubReq(signClosingPdfToken(ID)), ctx)).status).toBe(404);
    h.closing = null;
    expect((await publicPdf(pubReq(signClosingPdfToken(ID)), ctx)).status).toBe(404);
  });
});

const waReq = () => new NextRequest(`http://admin.test/api/closings/${ID}/wa`, { method: 'POST' });

describe('POST /api/closings/[id]/wa', () => {
  it('mengembalikan phone, message, url bertoken', async () => {
    const res = await waRoute(waReq(), ctx);
    expect(res.status).toBe(200);
    const d = await res.json() as { phone: string; message: string; url: string };
    expect(d.phone).toBe('081234567890');
    expect(d.url).toBe(`http://admin.test/api/closings/${ID}/pdf/public?t=${signClosingPdfToken(ID)}`);
    expect(d.message).toContain(d.url);
    expect(d.message).toContain('*CLOSING HPP — Cemilan Teh Risma*');
  });
  it('nomor toko kosong → 400 pesan jelas; tidak valid → 400', async () => {
    h.settings = { storeName: 'T', whatsapp: ' ' };
    const r1 = await waRoute(waReq(), ctx);
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe('Isi nomor WhatsApp toko di Pengaturan.');
    h.settings = { whatsapp: '123' };
    expect((await waRoute(waReq(), ctx)).status).toBe(400);
  });
  it('dibuka_ulang / saldo awal → 400; tidak ada → 404; tanpa izin → 403', async () => {
    h.closing = rec({ status: 'dibuka_ulang' });
    expect((await waRoute(waReq(), ctx)).status).toBe(400);
    h.closing = rec({ is_opening_balance: true });
    expect((await waRoute(waReq(), ctx)).status).toBe(400);
    h.closing = null;
    expect((await waRoute(waReq(), ctx)).status).toBe(404);
    h.perm = false;
    expect((await waRoute(waReq(), ctx)).status).toBe(403);
  });
});
