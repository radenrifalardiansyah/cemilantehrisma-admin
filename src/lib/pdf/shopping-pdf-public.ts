import type { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { isLinkPreviewBot } from '@/lib/closing-wa';
import type { ShoppingPdfTarget } from '@/lib/shopping-pdf-link';
import { shoppingListExists, shoppingPdfResponse } from '@/lib/pdf/shopping-pdf-server';
import { NO_STORE, notFound } from '@/lib/pdf/closing-pdf-public';
import { clientIp, rateLimit } from '@/lib/rate-limit';

// Inti rute PDF Daftar Belanja PUBLIK (/b/[code]). Pemanggil WAJIB sudah memverifikasi kode (HMAC).
// Urutan murah -> mahal: rate limit (memori) -> 1 query ada/tidak -> [HEAD/crawler: stop] -> PDF dari cache server
// 5 menit (miss: render sekali). Daftar kosong/dihapus -> 404 seragam. Respons private, no-store.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function servePublicShoppingPdf(req: NextRequest, code: string, target: ShoppingPdfTarget, method: 'GET' | 'HEAD'): Promise<Response> {
  const rl = rateLimit(`shopping|${code}|${clientIp(req.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return Response.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfterSec) } });
  }
  try {
    const sql = getSql();
    if (!await shoppingListExists(sql, target)) return notFound();
    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...NO_STORE, 'Content-Type': 'application/pdf' } });
    }
    if (isLinkPreviewBot(req.headers.get('user-agent'))) {
      const html = '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta property="og:title" content="Daftar Belanja (PDF)"><title>Daftar Belanja (PDF)</title>';
      return new Response(html, { status: 200, headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return await shoppingPdfResponse(sql, target);
  } catch (err) {
    console.error('[shopping/pdf/public]', err);
    return Response.json({ error: 'Gagal membuat PDF daftar belanja.' }, { status: 500, headers: NO_STORE });
  }
}
