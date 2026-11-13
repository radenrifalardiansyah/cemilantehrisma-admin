import type { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { isPubliclyShareableClosing, isLinkPreviewBot } from '@/lib/closing-wa';
import { getClosingStatus, serveClosingPdf } from '@/lib/pdf/closing-pdf-server';
import { clientIp, rateLimit } from '@/lib/rate-limit';

// Inti rute PDF closing PUBLIK, dipakai bersama oleh /api/closings/[id]/pdf/public (token panjang) dan /c/[code]
// (kode ringkas). Pemanggil WAJIB sudah memverifikasi token/kode (HMAC) sebelum memanggil fungsi ini.
//
// Urutan murah → mahal: rate limit (memori) → 1 query status → [HEAD/crawler: stop] → PDF dari cache server
// (miss: render + query baris, sekali per closing). Token/kode salah, closing tidak ada, bukan 'aktif', atau saldo
// awal → 404 seragam (tidak membocorkan keberadaan closing). Respons private, no-store: link harus langsung
// ditolak setelah closing dibuka ulang, jadi tidak boleh ada cache CDN/browser; penghematan biaya ada di cache SERVER.
export const NO_STORE = { 'Cache-Control': 'private, no-store' };
export const notFound = () => Response.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404, headers: NO_STORE });

const RATE_LIMIT = 20;            // permintaan per closing+IP per jendela (instance yang sama)
const RATE_WINDOW_MS = 60_000;

export async function servePublicClosingPdf(req: NextRequest, id: string, method: 'GET' | 'HEAD'): Promise<Response> {
  const rl = rateLimit(`${id}|${clientIp(req.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return Response.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfterSec) } });
  }

  try {
    const sql = getSql();
    const row = await getClosingStatus(sql, id);
    if (!row || !isPubliclyShareableClosing(row)) return notFound();

    // HEAD & crawler pratinjau: jangan render. Token/kode + status sudah terverifikasi di atas.
    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...NO_STORE, 'Content-Type': 'application/pdf' } });
    }
    if (isLinkPreviewBot(req.headers.get('user-agent'))) {
      const html = '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta property="og:title" content="Closing HPP (PDF)"><title>Closing HPP (PDF)</title>';
      return new Response(html, { status: 200, headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return (await serveClosingPdf(sql, id, { publicOnly: true, status: row })) ?? notFound();
  } catch (err) {
    console.error('[closings/pdf/public]', err);
    return Response.json({ error: 'Gagal membuat PDF closing.' }, { status: 500, headers: NO_STORE });
  }
}
