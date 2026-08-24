import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
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
  let pendingCreated = 0;

  // Commit tiap chunk dibungkus try/catch — tanpa ini, satu commit gagal di tengah jalan
  // (mis. error jaringan sesaat) membuat seluruh request 500 tanpa laporan created/skipped sama
  // sekali, padahal chunk-chunk sebelumnya sudah permanen tersimpan.
  async function flush(): Promise<boolean> {
    if (opsInBatch === 0) return true;
    try {
      await batch.commit();
      created += pendingCreated;
      batch = db.batch();
      opsInBatch = 0;
      pendingCreated = 0;
      return true;
    } catch (err) {
      console.error('Bulk import bahan baku: commit chunk gagal', err);
      return false;
    }
  }

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
    pendingCreated++;
    opsInBatch++;

    if (opsInBatch >= BATCH_LIMIT && !(await flush())) {
      if (created > 0) revalidateTag('admin-materials', { expire: 0 });
      return Response.json({
        created, skippedInvalid, skippedDuplicate,
        error: `Impor terhenti — ${created} bahan baku berhasil disimpan sebelum gagal. Data yang sudah tersimpan aman; coba impor ulang sisanya.`,
      }, { status: 500 });
    }
  }
  if (!(await flush())) {
    if (created > 0) revalidateTag('admin-materials', { expire: 0 });
    return Response.json({
      created, skippedInvalid, skippedDuplicate,
      error: `Impor terhenti — ${created} bahan baku berhasil disimpan sebelum gagal. Data yang sudah tersimpan aman; coba impor ulang sisanya.`,
    }, { status: 500 });
  }
  if (created > 0) revalidateTag('admin-materials', { expire: 0 });

  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
