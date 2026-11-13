import { createHmac, timingSafeEqual } from 'node:crypto';
import { formatDate, formatRp } from '@/lib/format';
import { terbilangRupiah } from '@/lib/terbilang';
import { dayLabel, type ClosingRecord } from '@/lib/pdf/closing-pdf-data';

// Kirim WA Closing HPP: pembentuk pesan + token tautan PDF publik. Murni (tanpa DB/HTTP) supaya bisa diuji.

export const DEFAULT_STORE_NAME = 'Cemilan Teh Risma';

// ── Token tautan PDF publik ─────────────────────────────────────────────────
// HMAC-SHA256(JWT_SECRET, `closing-pdf:${id}`) base64url. Rahasia = JWT_SECRET yang sudah ada (tidak ada env baru);
// prefiks `closing-pdf:` memisahkan domain dari pemakaian JWT_SECRET lain. Tanpa JWT_SECRET: tidak ada token
// yang bisa dibuat maupun diverifikasi (gagal tertutup, bukan memakai kunci kosong).
function tokenFor(id: string): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`closing-pdf:${id}`).digest('base64url');
}

export function signClosingPdfToken(id: string): string {
  const t = tokenFor(id);
  if (!t) throw new Error('JWT_SECRET belum dikonfigurasi.');
  return t;
}

export function verifyClosingPdfToken(id: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const want = tokenFor(id);
  if (!want) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Hanya closing resmi berstatus 'aktif' dan bukan saldo awal yang punya tautan publik.
export const isPubliclyShareableClosing = (c: Pick<ClosingRecord, 'status' | 'is_opening_balance'>): boolean =>
  c.status === 'aktif' && !c.is_opening_balance;

// User-Agent pembuat pratinjau tautan / bot: tidak perlu PDF-nya, cukup 200 ringan.
const PREVIEW_BOT_RE = /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|slack-imgproxy|linkedinbot|discordbot|skypeuripreview|embedly|pinterest|redditbot|vkshare|googlebot|bingbot|applebot|crawler|spider|preview/i;
export const isLinkPreviewBot = (userAgent: string | null | undefined): boolean => !!userAgent && PREVIEW_BOT_RE.test(userAgent);

// Tag cache PDF closing (dipisah di sini supaya rute reopen/settings tidak menarik react-pdf ke bundelnya).
export const CLOSING_PDF_TAG = 'closing-pdf';
export const closingPdfTag = (id: string) => `closing-pdf:${id}`;

// ── Pesan ───────────────────────────────────────────────────────────────────
const titleCase = (t: string) => t.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());

// "12 – 13 Nov 2026"; satu tanggal bila sama; bulan/tahun berbeda ditulis lengkap di sisi yang berbeda.
export function periodLabel(from: string | null, to: string): string {
  if (!from || from === to) return dayLabel(to);
  const [d1, m1, y1] = dayLabel(from).split(' ');
  const [d2, m2, y2] = dayLabel(to).split(' ');
  if (y1 !== y2) return `${d1} ${m1} ${y1} – ${d2} ${m2} ${y2}`;
  if (m1 !== m2) return `${d1} ${m1} – ${d2} ${m2} ${y2}`;
  return `${d1} – ${d2} ${m2} ${y2}`;
}

const stamp = (d: Date) => `${formatDate(d, 'short', 'Asia/Jakarta')}, ${formatDate(d, 'time', 'Asia/Jakarta')}`;

export function buildClosingWaMessage(c: ClosingRecord, opts: { storeName?: string; pdfUrl: string }): string {
  const cogs = Number(c.total_cogs ?? 0);
  const revenue = Number(c.total_revenue ?? 0);
  const store = opts.storeName?.trim() || DEFAULT_STORE_NAME;
  return [
    `*CLOSING HPP — ${store}*`,
    `Ditutup: ${stamp(c.closed_at)} oleh ${c.closed_by || '–'}`,
    '',
    `Periode   : ${periodLabel(c.period_from, c.period_to)}`,
    `Transaksi : ${c.item_count}`,
    `Omzet     : ${formatRp(revenue)}`,
    `*HPP      : ${formatRp(cogs)}*`,
    `Terbilang : ${titleCase(terbilangRupiah(cogs))}`,
    '',
    'Mohon dicek dan ditransfer. Terima kasih 🙏',
    `Rincian (PDF): ${opts.pdfUrl}`,
  ].join('\n');
}
