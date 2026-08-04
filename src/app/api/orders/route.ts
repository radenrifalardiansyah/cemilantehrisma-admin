import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');
  const db = getDb();

  let query: Query<DocumentData> = db.collection('orders').orderBy('createdAt', 'desc');
  if (from) query = query.where('createdAt', '>=', Timestamp.fromDate(new Date(`${from}T00:00:00`)));
  if (to)   query = query.where('createdAt', '<=', Timestamp.fromDate(new Date(`${to}T23:59:59.999`)));
  if (!from && !to) {
    const limit = parseInt(searchParams.get('limit') ?? '50');
    query = query.limit(limit);
  }

  const snap = await query.get();
  const orders = snap.docs.map(d => {
    const data = d.data();
    const createdAt = data.createdAt as Timestamp | undefined;
    return { id: d.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null };
  });
  return Response.json({ orders });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as Record<string, unknown> & { transactionAt?: string };
  const { transactionAt, ...rest } = data;
  const db = getDb();
  // Kasir bisa mengedit tanggal & jam transaksi (mis. transaksi baru sempat diinput belakangan) —
  // kalau dikirim, itu yang jadi createdAt (dipakai buat urutan & filter periode di Pesanan/Laporan
  // Keuangan). Kalau tidak dikirim (mis. checkout website), pakai waktu server seperti biasa.
  const createdAt = transactionAt ? Timestamp.fromDate(new Date(transactionAt)) : FieldValue.serverTimestamp();
  const ref = await db.collection('orders').add({
    ...rest,
    status: 'done',
    source: 'kasir',
    createdAt,
  });
  return Response.json({ id: ref.id });
}
