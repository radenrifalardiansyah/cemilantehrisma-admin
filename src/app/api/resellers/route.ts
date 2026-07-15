import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveCustomerId, RESELLER_STATUSES, ManualCustomer, ResellerStatus } from '@/lib/resellers';

type ResellerBody = {
  customerId?: string;
  customer?: ManualCustomer;
  bankName?: string; bankAccount?: string; bankHolder?: string;
  status?: ResellerStatus;
};

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const db = getDb();
  const snap = await db.collection('resellers').orderBy('createdAt', 'desc').get();
  const resellers = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Array<Record<string, unknown> & { id: string; customerId?: string }>;

  const customerIds = [...new Set(resellers.map(r => r.customerId).filter((v): v is string => !!v))];
  const customerDocs = customerIds.length
    ? await db.getAll(...customerIds.map(id => db.collection('customers').doc(id)))
    : [];
  const customerMap = new Map(customerDocs.map(d => [d.id, d.data()]));

  const merged = resellers.map(r => {
    const c = r.customerId ? customerMap.get(r.customerId) : undefined;
    return {
      ...r,
      name: c?.name ?? '(Pelanggan dihapus)',
      phone: c?.phone ?? '',
      code: c?.code ?? '',
      email: c?.email ?? '',
      address: c?.address ?? '',
      city: c?.city ?? '',
    };
  });

  return Response.json({ resellers: merged });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const body = await req.json() as ResellerBody;
  const db = getDb();

  const resolved = await resolveCustomerId(db, body);
  if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });

  const existing = await db.collection('resellers').where('customerId', '==', resolved.customerId).limit(1).get();
  if (!existing.empty) {
    return Response.json({ error: 'Pelanggan ini sudah terdaftar sebagai reseller.' }, { status: 409 });
  }

  const status = RESELLER_STATUSES.includes(body.status as ResellerStatus) ? body.status! : 'pending';
  const ref = await db.collection('resellers').add({
    customerId: resolved.customerId,
    bankName: body.bankName?.trim() ?? '',
    bankAccount: body.bankAccount?.trim() ?? '',
    bankHolder: body.bankHolder?.trim() ?? '',
    status,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id, customerId: resolved.customerId });
}
