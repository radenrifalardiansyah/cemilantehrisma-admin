import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { RESELLER_STATUSES, ResellerStatus } from '@/lib/resellers';

interface ImportRow {
  phone: string; name: string; city?: string; address?: string;
  bankName?: string; bankAccount?: string; bankHolder?: string; status?: ResellerStatus;
}

const BATCH_LIMIT = 400;

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { resellers } = await req.json() as { resellers: ImportRow[] };
  if (!Array.isArray(resellers) || resellers.length === 0) {
    return Response.json({ error: 'Tidak ada data reseller untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const customersSnap = await db.collection('customers').get();
  const customerIdByPhone = new Map(
    customersSnap.docs
      .map(d => [((d.data().phone as string) ?? '').trim(), d.id] as const)
      .filter(([phone]) => phone),
  );

  const resellersSnap = await db.collection('resellers').get();
  const existingResellerCustomerIds = new Set(resellersSnap.docs.map(d => d.data().customerId as string));
  const seenCustomerIds = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  for (const row of resellers) {
    const phone = (row.phone ?? '').toString().trim();
    const name  = (row.name  ?? '').toString().trim();
    if (!phone && !name) { skippedInvalid++; continue; }

    let customerId = phone ? customerIdByPhone.get(phone) : undefined;
    if (!customerId) {
      if (!name) { skippedInvalid++; continue; }
      const ref = db.collection('customers').doc();
      batch.set(ref, {
        name, phone, code: '', type: 'personal', email: '',
        address: (row.address ?? '').toString().trim(), city: (row.city ?? '').toString().trim(), notes: '',
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      customerId = ref.id;
      if (phone) customerIdByPhone.set(phone, customerId);
      opsInBatch++;
    }

    if (existingResellerCustomerIds.has(customerId) || seenCustomerIds.has(customerId)) {
      skippedDuplicate++; continue;
    }
    seenCustomerIds.add(customerId);

    const resellerRef = db.collection('resellers').doc();
    batch.set(resellerRef, {
      customerId,
      bankName: (row.bankName ?? '').toString().trim(),
      bankAccount: (row.bankAccount ?? '').toString().trim(),
      bankHolder: (row.bankHolder ?? '').toString().trim(),
      status: row.status && RESELLER_STATUSES.includes(row.status) ? row.status : 'pending',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
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
