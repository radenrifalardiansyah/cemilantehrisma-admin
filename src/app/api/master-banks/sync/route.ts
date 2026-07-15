import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { MASTER_BANKS } from '@/lib/master-banks';

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const db = getDb();
  const batch = db.batch();
  let created = 0;

  for (const b of MASTER_BANKS) {
    const ref = db.collection('masterBanks').doc(b.code);
    const existing = await ref.get();
    if (!existing.exists) {
      batch.set(ref, { ...b, createdAt: FieldValue.serverTimestamp() });
      created++;
    } else {
      batch.set(ref, b, { merge: true });
    }
  }

  await batch.commit();
  return Response.json({ synced: created, total: MASTER_BANKS.length });
}
