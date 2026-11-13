import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { serveClosingPdf } from '@/lib/pdf/closing-pdf-server';

export const runtime = 'nodejs';

// PDF sebuah closing yang sudah ada. Hanya baca — cukup izin 'view' Laporan Produk (tidak perlu 'close').
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;
  try {
    const { id } = await params;
    // Closing aktif memakai cache server yang sama dengan rute publik; closing lain dirender langsung seperti biasa.
    const res = await serveClosingPdf(getSql(), id);
    return res ?? Response.json({ error: 'Closing tidak ditemukan.' }, { status: 404 });
  } catch (err) {
    console.error('[closings/pdf]', err);
    return Response.json({ error: 'Gagal membuat PDF closing.' }, { status: 500 });
  }
}
