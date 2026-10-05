import { NextRequest } from 'next/server';
import { requireSession } from '@/lib/rbac';
import { getDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Doc ID = token FCM itu sendiri — registrasi ulang token yang sama otomatis dedup lewat merge.
export async function POST(req: NextRequest) {
  const user = await requireSession(req);
  if (user instanceof Response) return user;
  const { token } = await req.json() as { token?: string };
  if (!token) return Response.json({ error: 'Token wajib diisi.' }, { status: 400 });

  await getDb().collection('fcmTokens').doc(token).set({
    username: user.username,
    role: user.role,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return Response.json({ ok: true });
}

// Dipanggil saat logout — tanpa ini, token FCM device ini terus terdaftar ke `username` walau
// sesinya sudah berakhir, jadi perangkat yang dipakai bergantian (mis. kios/tablet toko) tetap
// menerima push (termasuk pesan chat pribadi) yang ditujukan untuk user yang sudah logout.
export async function DELETE(req: NextRequest) {
  const user = await requireSession(req);
  if (user instanceof Response) return user;
  const { token } = await req.json() as { token?: string };
  if (!token) return Response.json({ error: 'Token wajib diisi.' }, { status: 400 });

  await getDb().collection('fcmTokens').doc(token).delete();
  return Response.json({ ok: true });
}
