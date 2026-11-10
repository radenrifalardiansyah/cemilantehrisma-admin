import { NextRequest } from 'next/server';
import { requireSession } from '@/lib/rbac';
import { getDb } from '@/lib/firebase-admin';
import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';

const PAGE = 400; // < batas 500 operasi per batch Firestore

// Tandai SEMUA notifikasi sebagai sudah dibaca oleh user ini — bukan hanya yang sedang tampil.
// Firestore tidak bisa query "array tidak mengandung", jadi seluruh koleksi dipindai per halaman
// (hanya field readBy yang dibaca) lalu update-nya di-batch.
export async function PATCH(req: NextRequest) {
  const user = await requireSession(req);
  if (user instanceof Response) return user;

  const db = getDb();
  let count = 0;
  let last: DocumentSnapshot | undefined;

  for (;;) {
    let q = db.collection('notifications').orderBy('createdAt', 'desc').select('readBy').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    const unread = snap.docs.filter(d => !((d.data().readBy as string[] | undefined) ?? []).includes(user.username));
    if (unread.length > 0) {
      const batch = db.batch();
      unread.forEach(d => batch.update(d.ref, { readBy: FieldValue.arrayUnion(user.username) }));
      await batch.commit();
      count += unread.length;
    }

    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }

  return Response.json({ ok: true, count });
}
