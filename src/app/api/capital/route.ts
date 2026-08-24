import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb, serializeTimestamp } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Query, DocumentData } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

// CapitalTab always fetches with no from/to and sums the FULL result client-side for its
// "Total Modal"/"Total Prive"/"Saldo Modal" cards — unlike orders/income/expenses, this can't
// just get a `.limit()` fallback without silently corrupting those totals once an account has
// more entries than the limit. Caching (arguments are part of the key, so from/to variants
// each get their own cache entry) is the safe lever here: same tradeoff already accepted for
// analytics/overview and analytics/consignment — still an unbounded scan on a cache miss, but
// concurrent opens within the TTL window share one Firestore read instead of one each.
const getCachedCapitalEntries = unstable_cache(
  async (from: string | null, to: string | null) => {
    let query: Query<DocumentData> = getDb().collection('capitalEntries').orderBy('date', 'desc');
    if (from) query = query.where('date', '>=', from);
    if (to)   query = query.where('date', '<=', to);
    const snap = await query.get();
    return snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: serializeTimestamp(data.createdAt), updatedAt: serializeTimestamp(data.updatedAt) };
    });
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
  const db = getDb();
  const payload = {
    type: data.type === 'prive' ? 'prive' : 'modal',
    amount,
    date: data.date,
    note: data.note ?? '',
    walletId: data.walletId ?? null,
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
  revalidateTag('admin-capital', { expire: 0 });
  return Response.json({ id: ref.id });
}
