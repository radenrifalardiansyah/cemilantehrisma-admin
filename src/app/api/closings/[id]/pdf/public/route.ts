import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { isPubliclyShareableClosing, isLinkPreviewBot, verifyClosingPdfToken } from '@/lib/closing-wa';
import { getClosingStatus, serveClosingPdf } from '@/lib/pdf/closing-pdf-server';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Rute PUBLIK (tanpa x-admin-auth; proyek ini tidak punya middleware/proxy — tiap rute menjaga dirinya sendiri
// lewat requirePermission, jadi rute tanpa guard = publik). Dibuka dari link WhatsApp; akses dijaga token HMAC
// `?t=` (lihat closing-wa.ts). Token salah / closing tidak ada / bukan 'aktif' / saldo awal → 404 seragam
// (tidak membocorkan keberadaan closing). Respons private, no-store: link harus langsung ditolak setelah closing
// dibuka ulang, jadi tidak boleh ada cache CDN/browser; penghematan biaya ada di cache SERVER (lihat closing-pdf-server).
//
// Urutan murah → mahal: token (HMAC lokal, tanpa I/O) → rate limit (memori) → 1 query status → [HEAD/crawler: stop]
// → PDF dari cache server (miss: render + query baris, sekali per closing).
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const notFound = () => Response.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404, headers: NO_STORE });

const RATE_LIMIT = 20;            // permintaan per token+IP per jendela (instance yang sama)
const RATE_WINDOW_MS = 60_000;

async function handle(req: NextRequest, { params }: { params: Promise<{ id: string }> }, method: 'GET' | 'HEAD') {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get('t');
  if (!verifyClosingPdfToken(id, token)) return notFound();

  const rl = rateLimit(`${id}|${clientIp(req.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return Response.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfterSec) } });
  }

  try {
    const sql = getSql();
    const row = await getClosingStatus(sql, id);
    if (!row || !isPubliclyShareableClosing(row)) return notFound();

    // HEAD & crawler pratinjau: jangan render. Token + status sudah terverifikasi di atas.
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

export const GET = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => handle(req, ctx, 'GET');
export const HEAD = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => handle(req, ctx, 'HEAD');
