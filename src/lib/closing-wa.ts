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

// ── Tautan ringkas: /c/<kode> ───────────────────────────────────────────────
// kode (38 karakter) = base64url(16 byte UUID closing) [22] + base64url(12 byte pertama HMAC token) [16].
// 96-bit tanda tangan cukup untuk menolak tebakan; tautan jadi ±80 karakter (bukan ±165). Hanya untuk id
// berbentuk UUID (closing dibuat dengan randomUUID); selain itu dipakai tautan panjang.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_SIG_BYTES = 12;
const ID_PART_LEN = 22; // base64url dari 16 byte, tanpa padding

function rawSig(id: string): Buffer | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`closing-pdf:${id}`).digest();
}

/** Kode ringkas untuk id UUID, atau null bila id bukan UUID / JWT_SECRET kosong. */
export function signClosingShortCode(id: string): string | null {
  if (!UUID_RE.test(id)) return null;
  const sig = rawSig(id);
  if (!sig) return null;
  const idPart = Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
  return idPart + sig.subarray(0, SHORT_SIG_BYTES).toString('base64url');
}

/** Verifikasi kode ringkas; mengembalikan id closing bila valid, selain itu null. */
export function parseClosingShortCode(code: string | null | undefined): string | null {
  if (!code || code.length !== ID_PART_LEN + Math.ceil((SHORT_SIG_BYTES * 4) / 3)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
  const bytes = Buffer.from(code.slice(0, ID_PART_LEN), 'base64url');
  if (bytes.length !== 16) return null;
  const hex = bytes.toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const sig = rawSig(id);
  if (!sig) return null;
  const a = Buffer.from(code.slice(ID_PART_LEN));
  const b = Buffer.from(sig.subarray(0, SHORT_SIG_BYTES).toString('base64url'));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** Tautan PDF publik untuk pesan WA: ringkas (/c/<kode>) untuk id UUID, tautan panjang bertoken untuk lainnya. */
export function buildClosingPdfUrl(origin: string, id: string): string {
  const code = signClosingShortCode(id);
  return code ? `${origin}/c/${code}` : `${origin}/api/closings/${id}/pdf/public?t=${signClosingPdfToken(id)}`;
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

// Qty bisa pecahan (cicilan proporsional): tampilkan maksimal 2 desimal, tanpa desimal bila bulat.
const qtyLabel = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

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
    `Terjual   : ${qtyLabel(Number(c.total_qty ?? 0))} Pcs`,
    `Omzet     : ${formatRp(revenue)}`,
    `*HPP      : ${formatRp(cogs)}*`,
    `Terbilang : *${titleCase(terbilangRupiah(cogs))}*`,
    '',
    'Mohon dicek dan ditransfer. Terima kasih 🙏',
    `Rincian (PDF): ${opts.pdfUrl}`,
  ].join('\n');
}
