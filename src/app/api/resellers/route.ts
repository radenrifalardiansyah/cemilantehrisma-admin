import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const snap = await getDb().collection('resellers').orderBy('createdAt', 'desc').get();
  const resellers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ resellers });
}
