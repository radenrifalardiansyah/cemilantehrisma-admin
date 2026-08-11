import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

interface ImportRow { name: string; unit: string }

const BATCH_LIMIT = 400;

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const { materials } = await req.json() as { materials: ImportRow[] };
  if (!Array.isArray(materials) || materials.length === 0) {
    return Response.json({ error: 'Tidak ada data bahan baku untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const existingSnap = await db.collection('rawMaterials').get();
  const existingNames = new Set(
    existingSnap.docs.map(d => ((d.data().name as string) ?? '').trim().toLowerCase()).filter(Boolean),
  );
  const seenNames = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  for (const row of materials) {
    const name = (row.name ?? '').toString().trim();
    const unit = (row.unit ?? '').toString().trim();
    if (!name || !unit) { skippedInvalid++; continue; }
    const key = name.toLowerCase();
    if (existingNames.has(key) || seenNames.has(key)) { skippedDuplicate++; continue; }

    seenNames.add(key);
    const ref = db.collection('rawMaterials').doc();
    batch.set(ref, {
      name, unit, stockQty: 0, avgCost: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    created++;
    opsInBatch++;

    if (opsInBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
