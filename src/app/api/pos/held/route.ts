import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

// Transaksi tertahan (Hold/Pending) di Kasir — disimpan di Firestore (bukan localStorage)
// supaya bisa dilanjutkan dari perangkat manapun, bukan cuma perangkat yang menahannya.

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'pos', 'view');
  if (user instanceof Response) return user;
  const snap = await getDb().collection('posHeldTransactions').get();
  const held = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>))
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  return Response.json({ held });
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'pos', 'create');
  if (user instanceof Response) return user;
  const body = await req.json() as Record<string, unknown>;

  const db = getDb();
  const ref = db.collection('posHeldTransactions').doc();
  const data = {
    label: String(body.label ?? ''),
    cart: Array.isArray(body.cart) ? body.cart : [],
    customItems: Array.isArray(body.customItems) ? body.customItems : [],
    custName: String(body.custName ?? ''),
    custPhone: String(body.custPhone ?? ''),
    discountType: body.discountType === 'nominal' ? 'nominal' : 'percent',
    discountRaw: String(body.discountRaw ?? ''),
    paymentMethod: String(body.paymentMethod ?? 'cash'),
    amountPaidRaw: String(body.amountPaidRaw ?? ''),
    transferBank: String(body.transferBank ?? ''),
    transferAmountRaw: String(body.transferAmountRaw ?? ''),
    transferProofUrl: String(body.transferProofUrl ?? ''),
    selectedCustRef: String(body.selectedCustRef ?? ''),
    createdAt: Number(body.createdAt) || Date.now(),
    createdBy: user.username,
  };
  await ref.set(data);
  return Response.json({ held: { id: ref.id, ...data } });
}
