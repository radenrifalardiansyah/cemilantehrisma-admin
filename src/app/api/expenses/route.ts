import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Query, DocumentData } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'expenses', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');

  let query: Query<DocumentData> = getDb().collection('expenses').orderBy('date', 'desc');
  if (from) query = query.where('date', '>=', from);
  if (to)   query = query.where('date', '<=', to);

  const snap = await query.get();
  const expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ expenses });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'expenses', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const payload = {
    category: data.category ?? 'Lainnya',
    description: data.description ?? '',
    amount: Number(data.amount) || 0,
    items: Array.isArray(data.items) ? data.items : [],
    date: data.date,
    note: data.note ?? '',
  };
  const ref = await db.collection('expenses').add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    await logHistory(db, {
      entity: 'expenses',
      entityId: ref.id,
      entityLabel: `${payload.description || payload.category || 'Pengeluaran'} - Rp ${(payload.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for expenses create', err);
  }
  try {
    await notify(db, {
      type: 'expense_new',
      title: 'Pengeluaran baru',
      message: `${guard.username} mencatat pengeluaran ${payload.description || payload.category || ''} Rp${(payload.amount ?? 0).toLocaleString('id-ID')}.`,
      link: 'expenses',
      entityCollection: 'expenses', entityId: ref.id,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to write notification for expenses create', err);
  }
  return Response.json({ id: ref.id });
}
