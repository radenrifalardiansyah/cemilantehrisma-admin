import { NextRequest } from 'next/server';
import { getDb, serializeTimestamp } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;
  const snap = await getDb().collection('wallets').orderBy('order', 'asc').get();
  const wallets = snap.docs.map(d => {
    const data = d.data();
    return { id: d.id, ...data, createdAt: serializeTimestamp(data.createdAt), updatedAt: serializeTimestamp(data.updatedAt) };
  });
  return Response.json({ wallets });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    return Response.json({ error: 'Nama dompet wajib diisi.' }, { status: 400 });
  }

  const existingSnap = await db.collection('wallets').orderBy('order', 'desc').limit(1).get();
  const nextOrder = existingSnap.empty ? 0 : (Number(existingSnap.docs[0].data().order) || 0) + 1;

  const payload = {
    name: data.name.trim(),
    type: ['cash', 'bank', 'ewallet', 'other'].includes(data.type as string) ? data.type : 'cash',
    icon: typeof data.icon === 'string' && data.icon ? data.icon : 'Wallet',
    color: typeof data.color === 'string' && data.color ? data.color : '#D4691E',
    initialBalance: Number(data.initialBalance) || 0,
    isActive: true,
    order: nextOrder,
  };
  const ref = await db.collection('wallets').add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    await logHistory(db, {
      entity: 'wallets',
      entityId: ref.id,
      entityLabel: payload.name,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for wallets create', err);
  }
  return Response.json({ id: ref.id });
}
