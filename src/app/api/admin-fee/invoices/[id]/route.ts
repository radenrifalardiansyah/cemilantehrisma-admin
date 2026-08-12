import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requireSuperAdmin } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const snap = await getDb().collection('adminFeeInvoices').doc(id).get();
  if (!snap.exists) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  const data = snap.data()!;
  const createdAt = data.createdAt as Timestamp | undefined;
  return Response.json({ invoice: { id: snap.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const data = await req.json() as { status?: 'draft' | 'invoiced' | 'paid' };
  if (!data.status || !['draft', 'invoiced', 'paid'].includes(data.status)) {
    return Response.json({ error: 'Status tidak valid.' }, { status: 400 });
  }
  await getDb().collection('adminFeeInvoices').doc(id).update({
    status: data.status,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}
