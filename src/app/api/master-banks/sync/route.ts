import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { MASTER_BANKS } from '@/lib/master-banks';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
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
