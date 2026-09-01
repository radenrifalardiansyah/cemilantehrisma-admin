import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

interface ExpenseRow {
  id: string; category: string | null; description: string | null; amount: string;
  items: unknown; date: string; note: string | null; wallet_id: string | null;
  source_type: string | null; source_id: string | null;
  created_at: Date; updated_at: Date | null;
}

function toTimestamp(d: Date | null) {
  if (!d) return null;
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
}

function toExpense(r: ExpenseRow) {
  return {
    id: r.id,
    category: r.category ?? 'Lainnya',
    description: r.description ?? '',
    amount: Number(r.amount),
    items: parseJsonb(r.items as string | unknown[] | null) ?? [],
    date: r.date,
    note: r.note ?? '',
    walletId: r.wallet_id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}

// Migrated dari Firestore ke Postgres (Tahap 5 migrasi) — lihat plan gleaming-wondering-quokka.md.
// Ditulis juga dari material-purchases & production (lihat src/lib/expenses-pg.ts) — tag di sini
// mencakup jalur tulis itu juga, karena mereka sama-sama INSERT/UPDATE/DELETE ke tabel yang sama.
const getCachedExpenses = unstable_cache(
  async (from: string | null, to: string | null) => {
    const sql = getSql();
    const rows = await (from && to
      ? sql<ExpenseRow[]>`select * from expenses where date >= ${from} and date <= ${to} order by date desc`
      : from
      ? sql<ExpenseRow[]>`select * from expenses where date >= ${from} order by date desc`
      : to
      ? sql<ExpenseRow[]>`select * from expenses where date <= ${to} order by date desc`
      : sql<ExpenseRow[]>`select * from expenses order by date desc`);
    return rows.map(toExpense);
  },
  ['admin-expenses-list'],
  { revalidate: 15, tags: ['admin-expenses'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'expenses', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');

  const expenses = await getCachedExpenses(from, to);
  return Response.json({ expenses });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'expenses', 'create');
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
    insert into expenses (id, category, description, amount, items, date, note, wallet_id, created_at, updated_at)
    values (${id}, ${payload.category}, ${payload.description}, ${payload.amount}, ${JSON.stringify(payload.items)}, ${payload.date}, ${payload.note}, ${payload.walletId}, now(), now())
  `;
  const db = getDb();
  try {
    await logHistory(db, {
      entity: 'expenses',
      entityId: id,
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
      entityCollection: 'expenses', entityId: id,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to write notification for expenses create', err);
  }
  revalidateTag('admin-expenses', { expire: 0 });
  return Response.json({ id });
}
