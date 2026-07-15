import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();
  // Cukup 1 field equality (tanpa orderBy) supaya tidak butuh composite index —
  // aman karena POST di bawah menjamin cuma ada 1 shift 'open' pada satu waktu.
  const snap = await getDb()
    .collection('cashierShifts')
    .where('status', '==', 'open')
    .limit(1)
    .get();
  const shift = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  return Response.json({ shift });
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();
  const { openingBalance, note } = await req.json() as { openingBalance: number; note?: string };

  const db = getDb();
  const existing = await db.collection('cashierShifts').where('status', '==', 'open').limit(1).get();
  if (!existing.empty) {
    return Response.json({ error: 'Sudah ada sesi kasir yang terbuka.' }, { status: 409 });
  }

  const ref = await db.collection('cashierShifts').add({
    openedAt: FieldValue.serverTimestamp(),
    openedBy: user.username,
    openingBalance: Number(openingBalance) || 0,
    note: note?.trim() ?? '',
    status: 'open',
  });
  const doc = await ref.get();
  return Response.json({ shift: { id: ref.id, ...doc.data() } });
}
