import { NextRequest } from 'next/server';
import { verifyClosingPdfToken } from '@/lib/closing-wa';
import { notFound, servePublicClosingPdf } from '@/lib/pdf/closing-pdf-public';

export const runtime = 'nodejs';

// Rute PUBLIK (tanpa x-admin-auth; proyek ini tidak punya middleware/proxy — tiap rute menjaga dirinya sendiri
// lewat requirePermission, jadi rute tanpa guard = publik). Bentuk tautan PANJANG dengan token HMAC `?t=`
// (lihat closing-wa.ts). Tautan yang lebih ringkas ada di /c/[code]; keduanya memakai inti yang sama
// (servePublicClosingPdf) — token salah → 404 seragam sebelum menyentuh DB.
async function handle(req: NextRequest, { params }: { params: Promise<{ id: string }> }, method: 'GET' | 'HEAD') {
  const { id } = await params;
  if (!verifyClosingPdfToken(id, req.nextUrl.searchParams.get('t'))) return notFound();
  return servePublicClosingPdf(req, id, method);
}

export const GET = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => handle(req, ctx, 'GET');
export const HEAD = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => handle(req, ctx, 'HEAD');
