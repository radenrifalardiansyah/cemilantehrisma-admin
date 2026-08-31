import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb, serializeTimestamp } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Query, DocumentData } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

// Dibaca dengan from=2000-01-01 (seluruh riwayat) oleh useWalletBalances di 7 tab setiap kali ada
// transaksi baru — cache waktu murni (bukan revalidateTag) supaya lonjakan baca bersamaan
// diserap tanpa perlu invalidasi manual di tiap titik tulis. Lihat komentar serupa di
// src/app/api/orders/route.ts.
const getCachedIncome = unstable_cache(
  async (from: string | null, to: string | null) => {
    let query: Query<DocumentData> = getDb().collection('income').orderBy('date', 'desc');
    if (from) query = query.where('date', '>=', from);
    if (to)   query = query.where('date', '<=', to);
    const snap = await query.get();
    return snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: serializeTimestamp(data.createdAt), updatedAt: serializeTimestamp(data.updatedAt) };
    });
  },
  ['admin-income-list'],
  { revalidate: 15 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'income', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');

  const income = await getCachedIncome(from, to);
  return Response.json({ income });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'income', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const amount = Number(data.amount) || 0;
  if (amount <= 0) return Response.json({ error: 'Jumlah harus lebih dari 0.' }, { status: 400 });
  const db = getDb();
  const payload = {
    category: data.category ?? 'Lainnya',
    description: data.description ?? '',
    amount,
    items: Array.isArray(data.items) ? data.items : [],
    date: data.date,
    note: data.note ?? '',
    walletId: data.walletId ?? null,
  };
  const ref = await db.collection('income').add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    await logHistory(db, {
      entity: 'income',
      entityId: ref.id,
      entityLabel: `${payload.description || payload.category || 'Pemasukan'} - Rp ${(payload.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for income create', err);
  }
  try {
    await notify(db, {
      type: 'income_new',
      title: 'Pemasukan baru',
      message: `${guard.username} mencatat pemasukan ${payload.description || payload.category || ''} Rp${(payload.amount ?? 0).toLocaleString('id-ID')}.`,
      link: 'income',
      entityCollection: 'income', entityId: ref.id,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to write notification for income create', err);
  }
  return Response.json({ id: ref.id });
}
