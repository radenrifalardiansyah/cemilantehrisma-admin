import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Batas 50 sama dengan query realtime yang didengarkan client (NotificationBell) — konsisten
// dengan apa yang sedang ditampilkan, dan menjaga jumlah write per klik tetap kecil & flat.
export async function PATCH(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();

  const db = getDb();
  const snap = await db.collection('notifications').orderBy('createdAt', 'desc').limit(50).get();
  const unread = snap.docs.filter(d => !(d.data().readBy as string[] ?? []).includes(user.username));

  await Promise.all(unread.map(d => d.ref.update({ readBy: FieldValue.arrayUnion(user.username) })));
  return Response.json({ ok: true, count: unread.length });
}
