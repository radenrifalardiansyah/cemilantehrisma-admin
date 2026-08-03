import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

interface ImportRow { name: string; phone?: string; address?: string; note?: string }

const BATCH_LIMIT = 400;

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { suppliers } = await req.json() as { suppliers: ImportRow[] };
  if (!Array.isArray(suppliers) || suppliers.length === 0) {
    return Response.json({ error: 'Tidak ada data supplier untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const existingSnap = await db.collection('suppliers').get();
  const existingPhones = new Set(
    existingSnap.docs.map(d => ((d.data().phone as string) ?? '').trim()).filter(Boolean),
  );
  const seenPhones = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  for (const row of suppliers) {
    const name  = (row.name  ?? '').toString().trim();
    const phone = (row.phone ?? '').toString().trim();
    if (!name) { skippedInvalid++; continue; }
    if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) { skippedDuplicate++; continue; }

    if (phone) seenPhones.add(phone);
    const ref = db.collection('suppliers').doc();
    batch.set(ref, {
      name, phone,
      address: (row.address ?? '').toString().trim(),
      note:    (row.note    ?? '').toString().trim(),
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
