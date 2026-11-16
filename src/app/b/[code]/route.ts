import { NextRequest } from 'next/server';
import { parseShoppingShortCode } from '@/lib/shopping-pdf-link';
import { notFound } from '@/lib/pdf/closing-pdf-public';
import { servePublicShoppingPdf } from '@/lib/pdf/shopping-pdf-public';

export const runtime = 'nodejs';

// Tautan PDF Daftar Belanja RINGKAS untuk pesan WA: /b/<kode> (tanggal + supplier + tanda tangan HMAC, lihat
// shopping-pdf-link.ts). Rute PUBLIK (proyek tanpa middleware/proxy login); kode salah -> 404 seragam sebelum DB.
async function handle(req: NextRequest, { params }: { params: Promise<{ code: string }> }, method: 'GET' | 'HEAD') {
  const { code } = await params;
  const target = parseShoppingShortCode(code);
  if (!target) return notFound();
  return servePublicShoppingPdf(req, code, target, method);
}

export const GET = (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => handle(req, ctx, 'GET');
export const HEAD = (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => handle(req, ctx, 'HEAD');
