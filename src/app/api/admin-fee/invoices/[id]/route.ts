import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requireSuperAdmin, requireAdminOrSuperAdmin } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const snap = await getDb().collection('adminFeeInvoices').doc(id).get();
  if (!snap.exists) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  const data = snap.data()!;
  // Draft belum "ditagihkan" & invoice yang dibatalkan bukan lagi tagihan aktif —
  // jangan bocorkan ke `admin` walau tahu ID-nya.
  if (guard.role !== 'super-admin' && (data.status === 'draft' || data.status === 'cancelled')) {
    return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  }
  const createdAt = data.createdAt as Timestamp | undefined;
  return Response.json({ invoice: { id: snap.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const data = await req.json() as { status?: 'draft' | 'invoiced' | 'paid' | 'cancelled' };
  if (!data.status || !['draft', 'invoiced', 'paid', 'cancelled'].includes(data.status)) {
    return Response.json({ error: 'Status tidak valid.' }, { status: 400 });
  }

  const ref = getDb().collection('adminFeeInvoices').doc(id);
  if (data.status === 'cancelled') {
    const snap = await ref.get();
    if (!snap.exists) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
    // Invoice yang sudah lunas tidak boleh dibatalkan begitu saja — uangnya sudah diterima,
    // koreksi seharusnya lewat pembukuan/refund, bukan menghapus jejak tagihan yang sudah dibayar.
    if (snap.data()?.status === 'paid') {
      return Response.json({ error: 'Invoice yang sudah lunas tidak bisa dibatalkan.' }, { status: 400 });
    }
  }

  await ref.update({
    status: data.status,
    updatedAt: FieldValue.serverTimestamp(),
    // Superadmin bisa langsung menandai lunas manual (mis. bayar tunai/transfer langsung ke
    // RMedia di luar alur "Bayar" milik admin) — tetap dicatat siapa & kapan agar konsisten
    // dengan riwayat pembayaran yang dibuat lewat endpoint /pay.
    ...(data.status === 'paid' ? { paidAt: FieldValue.serverTimestamp(), paidBy: guard.username } : {}),
    ...(data.status === 'cancelled' ? { cancelledAt: FieldValue.serverTimestamp(), cancelledBy: guard.username } : {}),
  });
  return Response.json({ ok: true });
}
