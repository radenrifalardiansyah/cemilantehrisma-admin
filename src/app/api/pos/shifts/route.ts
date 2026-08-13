import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'pos', 'view');
  if (user instanceof Response) return user;
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
  const user = await requirePermission(req, 'pos', 'create');
  if (user instanceof Response) return user;
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
  const shiftData = doc.data();
  try {
    await logHistory(db, {
      entity: 'pos',
      entityCollection: 'cashierShifts',
      entityId: ref.id,
      entityLabel: `Sesi kasir ${shiftData?.openedBy ?? user.username}`,
      action: 'create',
      actor: user,
      after: shiftData,
    });
  } catch (err) {
    console.error('Failed to write history for pos shift create', err);
  }
  try {
    await notify(db, {
      type: 'pos_shift_open',
      title: 'Shift kasir dibuka',
      message: `${user.username} membuka sesi kasir dengan modal awal Rp${(Number(openingBalance) || 0).toLocaleString('id-ID')}.`,
      link: 'pos',
      entityCollection: 'cashierShifts', entityId: ref.id,
      actor: user,
    });
  } catch (err) {
    console.error('Failed to write notification for pos shift open', err);
  }
  return Response.json({ shift: { id: ref.id, ...shiftData } });
}
