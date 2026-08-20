import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Query, DocumentData } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'capital', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd
  const to   = searchParams.get('to');

  let query: Query<DocumentData> = getDb().collection('capitalEntries').orderBy('date', 'desc');
  if (from) query = query.where('date', '>=', from);
  if (to)   query = query.where('date', '<=', to);

  const snap = await query.get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ entries });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'capital', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const payload = {
    type: data.type === 'prive' ? 'prive' : 'modal',
    amount: Number(data.amount) || 0,
    date: data.date,
    note: data.note ?? '',
  };
  const ref = await db.collection('capitalEntries').add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const typeLabel = payload.type === 'prive' ? 'Modal Keluar' : 'Modal Masuk';
  try {
    await logHistory(db, {
      entity: 'capital',
      entityId: ref.id,
      entityLabel: `${typeLabel} Rp ${(payload.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for capital create', err);
  }
  try {
    await notify(db, {
      type: 'capital_new',
      title: `${typeLabel} baru`,
      message: `${guard.username} mencatat ${typeLabel.toLowerCase()} Rp${(payload.amount ?? 0).toLocaleString('id-ID')}.`,
      link: 'capital',
      entityCollection: 'capitalEntries', entityId: ref.id,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to write notification for capital create', err);
  }
  return Response.json({ id: ref.id });
}
