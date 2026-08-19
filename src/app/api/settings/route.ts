import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidateStorefront } from '@/lib/revalidate';

const DOC = 'main';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const doc = await getDb().collection('settings').doc(DOC).get();
  return Response.json({ settings: doc.exists ? doc.data() : {} });
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  await getDb().collection('settings').doc(DOC).set(
    { ...data, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  // Nota kirim ke mitra (via WA) di-cache 1 jam per shipment — invalidasi begitu
  // ada perubahan settings (logo/alamat/ttd/dll) supaya tidak menampilkan data basi.
  revalidateTag('settings', 'max');
  // Storefront (app terpisah) cache rekening/QRIS sendiri — beri tahu lewat
  // endpoint revalidate-nya juga, sama seperti products/categories/stats.
  after(() => revalidateStorefront('payment-info'));
  return Response.json({ ok: true });
}
