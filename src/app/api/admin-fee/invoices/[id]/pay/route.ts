import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requireAdminOrSuperAdmin } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

// Aksi "Bayar" milik `admin` (pemilik usaha) atas invoice Biaya Admin yang sudah ditagihkan
// superadmin — pembayaran manual (transfer di luar sistem, lalu konfirmasi di sini), bukan
// payment gateway. Sengaja endpoint terpisah dari PATCH /invoices/[id] (yang bebas set status
// apapun tapi superadmin-only): endpoint ini cuma boleh transisi invoiced -> paid, jadi admin
// tidak bisa mengubah status ke draft atau mengarang ulang nominal tagihan.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { note?: string };

  const ref = getDb().collection('adminFeeInvoices').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  const data = snap.data()!;
  if (data.status !== 'invoiced') {
    return Response.json({ error: 'Invoice ini belum ditagihkan atau sudah dibayar.' }, { status: 400 });
  }

  await ref.update({
    status: 'paid',
    paidAt: FieldValue.serverTimestamp(),
    paidBy: guard.username,
    paymentNote: body.note?.trim() || null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return Response.json({ ok: true });
}
