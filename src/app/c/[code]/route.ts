import { NextRequest } from 'next/server';
import { parseClosingShortCode } from '@/lib/closing-wa';
import { notFound, servePublicClosingPdf } from '@/lib/pdf/closing-pdf-public';

export const runtime = 'nodejs';

// Tautan PDF closing RINGKAS untuk pesan WA: /c/<kode 38 karakter> (id closing + tanda tangan HMAC, lihat
// closing-wa.ts). Rute PUBLIK; kode salah → 404 seragam sebelum menyentuh DB. Inti layanan dibagi dengan
// /api/closings/[id]/pdf/public (status, crawler/HEAD, cache server, rate limit).
async function handle(req: NextRequest, { params }: { params: Promise<{ code: string }> }, method: 'GET' | 'HEAD') {
  const { code } = await params;
  const id = parseClosingShortCode(code);
  if (!id) return notFound();
  return servePublicClosingPdf(req, id, method);
}

export const GET = (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => handle(req, ctx, 'GET');
export const HEAD = (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => handle(req, ctx, 'HEAD');
