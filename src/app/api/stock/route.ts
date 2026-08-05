import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { Timestamp, Query, DocumentData } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Stok untuk filter per periode
  const to   = searchParams.get('to');

  let query: Query<DocumentData> = getDb().collection('stock').orderBy('createdAt', 'desc');
  if (from) query = query.where('createdAt', '>=', Timestamp.fromDate(new Date(`${from}T00:00:00`)));
  if (to)   query = query.where('createdAt', '<=', Timestamp.fromDate(new Date(`${to}T23:59:59.999`)));
  if (!from && !to) query = query.limit(200);

  const snap = await query.get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ entries });
}
