import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requireSuperAdmin, requireAdminOrSuperAdmin } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

const DOC = 'paymentInfo';

// Rekening tujuan pembayaran Biaya Admin milik RMedia Solutions sendiri (ke mana `admin`
// harus transfer) — sengaja dokumen & endpoint TERPISAH dari /api/settings (yang isinya data
// toko milik `admin`). Kalau digabung ke situ, `admin` (pihak yang justru harus bayar ke sini)
// akan bisa mengedit nomor rekening tujuannya sendiri lewat halaman Pengaturan biasa.
export async function GET(req: NextRequest) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const doc = await getDb().collection('adminFeeSettings').doc(DOC).get();
  return Response.json({ paymentInfo: doc.exists ? doc.data() : {} });
}

export async function PUT(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const data = await req.json() as { bankName?: string; accountNumber?: string; accountHolder?: string };
  await getDb().collection('adminFeeSettings').doc(DOC).set({
    bankName: data.bankName?.trim() ?? '',
    accountNumber: data.accountNumber?.trim() ?? '',
    accountHolder: data.accountHolder?.trim() ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return Response.json({ ok: true });
}
