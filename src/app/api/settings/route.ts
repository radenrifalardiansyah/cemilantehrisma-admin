import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

const DOC = 'main';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const doc = await getDb().collection('settings').doc(DOC).get();
  return Response.json({ settings: doc.exists ? doc.data() : {} });
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  await getDb().collection('settings').doc(DOC).set(
    { ...data, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return Response.json({ ok: true });
}
