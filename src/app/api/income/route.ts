import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Query, DocumentData } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'income', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');

  let query: Query<DocumentData> = getDb().collection('income').orderBy('date', 'desc');
  if (from) query = query.where('date', '>=', from);
  if (to)   query = query.where('date', '<=', to);

  const snap = await query.get();
  const income = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ income });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'income', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('income').add({
    category: data.category ?? 'Lainnya',
    description: data.description ?? '',
    amount: Number(data.amount) || 0,
    items: Array.isArray(data.items) ? data.items : [],
    date: data.date,
    note: data.note ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
