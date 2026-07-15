import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

interface ImportRow {
  name: string; phone: string; code?: string; type?: 'personal' | 'company';
  email?: string; address?: string; city?: string; notes?: string;
}

const BATCH_LIMIT = 400;

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { customers } = await req.json() as { customers: ImportRow[] };
  if (!Array.isArray(customers) || customers.length === 0) {
    return Response.json({ error: 'Tidak ada data pelanggan untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const existingSnap = await db.collection('customers').get();
  const existingPhones = new Set(
    existingSnap.docs.map(d => ((d.data().phone as string) ?? '').trim()).filter(Boolean),
  );
  const existingCodes = new Set(
    existingSnap.docs.map(d => ((d.data().code as string) ?? '').trim()).filter(Boolean),
  );
  const seenPhones = new Set<string>();
  const seenCodes  = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  for (const row of customers) {
    const name  = (row.name  ?? '').toString().trim();
    const phone = (row.phone ?? '').toString().trim();
    const code  = (row.code  ?? '').toString().trim();
    if (!name) { skippedInvalid++; continue; }
    if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) { skippedDuplicate++; continue; }
    if (code && (existingCodes.has(code) || seenCodes.has(code))) { skippedDuplicate++; continue; }

    seenPhones.add(phone);
    if (code) seenCodes.add(code);
    const ref = db.collection('customers').doc();
    batch.set(ref, {
      name, phone, code,
      type:    row.type === 'company' ? 'company' : 'personal',
      email:   (row.email   ?? '').toString().trim(),
      address: (row.address ?? '').toString().trim(),
      city:    (row.city    ?? '').toString().trim(),
      notes:   (row.notes   ?? '').toString().trim(),
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
