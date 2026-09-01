import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

interface CapitalEntryRow {
  id: string; type: string; amount: string; date: string; note: string | null; wallet_id: string | null;
  created_at: Date; updated_at: Date | null;
}

function toTimestamp(d: Date | null) {
  if (!d) return null;
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
}

function toEntry(r: CapitalEntryRow) {
  return {
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    date: r.date,
    note: r.note ?? '',
    walletId: r.wallet_id,
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}

// Migrated dari Firestore ke Postgres (Tahap 2 migrasi) — lihat plan gleaming-wondering-quokka.md.
// CapitalTab selalu fetch tanpa from/to dan menjumlah SELURUH hasil di client untuk kartu
// "Total Modal"/"Total Prive"/"Saldo Modal" — cache tetap dipertahankan (arguments jadi bagian
// cache key) supaya banyak tab yang dibuka bersamaan berbagi satu query, bukan query per-tab.
const getCachedCapitalEntries = unstable_cache(
  async (from: string | null, to: string | null) => {
    const sql = getSql();
    const rows = await (from && to
      ? sql<CapitalEntryRow[]>`select * from capital_entries where date >= ${from} and date <= ${to} order by date desc`
      : from
      ? sql<CapitalEntryRow[]>`select * from capital_entries where date >= ${from} order by date desc`
      : to
      ? sql<CapitalEntryRow[]>`select * from capital_entries where date <= ${to} order by date desc`
      : sql<CapitalEntryRow[]>`select * from capital_entries order by date desc`);
    return rows.map(toEntry);
  },
  ['admin-capital-entries'],
  { revalidate: 15, tags: ['admin-capital'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'capital', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd
  const to   = searchParams.get('to');

  const entries = await getCachedCapitalEntries(from, to);
  return Response.json({ entries });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'capital', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const amount = Number(data.amount) || 0;
  if (amount <= 0) return Response.json({ error: 'Jumlah harus lebih dari 0.' }, { status: 400 });
  const payload = {
    type: data.type === 'prive' ? 'prive' : 'modal',
    amount,
    date: String(data.date ?? ''),
    note: (data.note as string | undefined) ?? '',
    walletId: (data.walletId as string | null | undefined) ?? null,
  };
  const id = randomUUID();
  const sql = getSql();
  await sql`
    insert into capital_entries (id, type, amount, date, note, wallet_id, created_at, updated_at)
    values (${id}, ${payload.type}, ${payload.amount}, ${payload.date}, ${payload.note}, ${payload.walletId}, now(), now())
  `;
  const db = getDb();
  const typeLabel = payload.type === 'prive' ? 'Modal Keluar' : 'Modal Masuk';
  try {
    await logHistory(db, {
      entity: 'capital',
      entityId: id,
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
      entityCollection: 'capitalEntries', entityId: id,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to write notification for capital create', err);
  }
  revalidateTag('admin-capital', { expire: 0 });
  return Response.json({ id });
}
