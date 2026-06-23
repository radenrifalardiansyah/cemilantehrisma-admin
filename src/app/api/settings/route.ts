import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

const DOC = 'main';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const doc = await getDb().collection('settings').doc(DOC).get();
  return Response.json(doc.exists ? doc.data() : {});
}

export async function PUT(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as Record<string, unknown>;
  await getDb().collection('settings').doc(DOC).set(
    { ...data, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return Response.json({ ok: true });
}
