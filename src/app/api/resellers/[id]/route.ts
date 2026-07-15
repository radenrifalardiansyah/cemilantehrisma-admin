import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveCustomerId, RESELLER_STATUSES, ManualCustomer, ResellerStatus } from '@/lib/resellers';

type Ctx = { params: Promise<{ id: string }> };
type ResellerBody = {
  customerId?: string;
  customer?: ManualCustomer;
  bankName?: string; bankAccount?: string; bankHolder?: string;
  status?: ResellerStatus;
};

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json() as ResellerBody;
  const db = getDb();

  const doc = await db.collection('resellers').doc(id).get();
  if (!doc.exists) return Response.json({ error: 'Reseller tidak ditemukan.' }, { status: 404 });

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (body.customerId || body.customer) {
    const resolved = await resolveCustomerId(db, body);
    if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });

    const existing = await db.collection('resellers').where('customerId', '==', resolved.customerId).limit(2).get();
    if (existing.docs.some(d => d.id !== id)) {
      return Response.json({ error: 'Pelanggan ini sudah terdaftar sebagai reseller.' }, { status: 409 });
    }
    update.customerId = resolved.customerId;
  }

  if (body.bankName    !== undefined) update.bankName    = body.bankName.trim();
  if (body.bankAccount !== undefined) update.bankAccount = body.bankAccount.trim();
  if (body.bankHolder  !== undefined) update.bankHolder  = body.bankHolder.trim();
  if (body.status && RESELLER_STATUSES.includes(body.status)) update.status = body.status;

  await db.collection('resellers').doc(id).update(update);
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  await getDb().collection('resellers').doc(id).delete();
  return Response.json({ ok: true });
}
