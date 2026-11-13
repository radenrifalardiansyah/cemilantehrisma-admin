import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getSettings } from '@/lib/settings-pg';
import { isValidIdMobile, PHONE_FORMAT_HINT } from '@/lib/phone';
import { buildClosingWaMessage, isPubliclyShareableClosing, signClosingPdfToken } from '@/lib/closing-wa';
import type { ClosingRecord } from '@/lib/pdf/closing-pdf-data';

export const runtime = 'nodejs';

// Menyusun pesan WA "Closing HPP" ke nomor toko. Token tautan PDF publik dibuat DI SINI (server) — klien tidak
// pernah memegang rahasia. Klien yang membuka wa.me; pengguna sendiri yang menekan Kirim.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, 'product-report', 'close');
  if (guard instanceof Response) return guard;
  try {
    const { id } = await params;
    const [closing] = await getSql()<ClosingRecord[]>`select * from closings where id = ${id}`;
    if (!closing) return Response.json({ error: 'Closing tidak ditemukan.' }, { status: 404 });
    if (!isPubliclyShareableClosing(closing)) {
      return Response.json({ error: 'Hanya closing aktif (bukan saldo awal) yang bisa dikirim lewat WA.' }, { status: 400 });
    }
    const settings = await getSettings() as { storeName?: string; whatsapp?: string };
    const phone = settings.whatsapp?.trim() ?? '';
    if (!phone) return Response.json({ error: 'Isi nomor WhatsApp toko di Pengaturan.' }, { status: 400 });
    if (!isValidIdMobile(phone)) return Response.json({ error: `Nomor WhatsApp toko di Pengaturan tidak valid. ${PHONE_FORMAT_HINT}` }, { status: 400 });

    const url = `${req.nextUrl.origin}/api/closings/${id}/pdf/public?t=${signClosingPdfToken(id)}`;
    const message = buildClosingWaMessage(closing, { storeName: settings.storeName, pdfUrl: url });
    return Response.json({ phone, message, url });
  } catch (err) {
    console.error('[closings/wa]', err);
    return Response.json({ error: 'Gagal menyiapkan pesan WhatsApp.' }, { status: 500 });
  }
}
