import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

interface IncomeRow {
  id: string; category: string | null; description: string | null; amount: string;
  items: unknown; date: string; note: string | null; wallet_id: string | null;
  created_at: Date; updated_at: Date | null;
}

function toTimestamp(d: Date | null) {
  if (!d) return null;
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
}

function toIncome(r: IncomeRow) {
  return {
    id: r.id,
    category: r.category ?? 'Lainnya',
    description: r.description ?? '',
    amount: Number(r.amount),
    items: r.items ?? [],
    date: r.date,
    note: r.note ?? '',
    walletId: r.wallet_id,
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}

// Migrated dari Firestore ke Postgres (Tahap 4 migrasi) — lihat plan gleaming-wondering-quokka.md.
// Dibaca dengan from=2000-01-01 (seluruh riwayat) oleh useWalletBalances di 7 tab setiap kali ada
// transaksi baru — cache waktu murni (bukan revalidateTag) supaya lonjakan baca bersamaan
// diserap tanpa perlu invalidasi manual di tiap titik tulis.
const getCachedIncome = unstable_cache(
  async (from: string | null, to: string | null) => {
    const sql = getSql();
    const rows = await (from && to
      ? sql<IncomeRow[]>`select * from income where date >= ${from} and date <= ${to} order by date desc`
      : from
      ? sql<IncomeRow[]>`select * from income where date >= ${from} order by date desc`
      : to
      ? sql<IncomeRow[]>`select * from income where date <= ${to} order by date desc`
      : sql<IncomeRow[]>`select * from income order by date desc`);
    return rows.map(toIncome);
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
  const payload = {
    category: (data.category as string | undefined) ?? 'Lainnya',
    description: (data.description as string | undefined) ?? '',
    amount,
    items: Array.isArray(data.items) ? data.items : [],
    date: String(data.date ?? ''),
    note: (data.note as string | undefined) ?? '',
    walletId: (data.walletId as string | null | undefined) ?? null,
  };
  const id = randomUUID();
  const sql = getSql();
  await sql`
    insert into income (id, category, description, amount, items, date, note, wallet_id, created_at, updated_at)
    values (${id}, ${payload.category}, ${payload.description}, ${payload.amount}, ${JSON.stringify(payload.items)}, ${payload.date}, ${payload.note}, ${payload.walletId}, now(), now())
  `;
  const db = getDb();
  try {
    await logHistory(db, {
      entity: 'income',
      entityId: id,
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
      entityCollection: 'income', entityId: id,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to write notification for income create', err);
  }
  return Response.json({ id });
}
