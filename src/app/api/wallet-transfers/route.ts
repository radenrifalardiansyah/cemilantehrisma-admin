import { NextRequest } from 'next/server';
import { getDb, serializeTimestamp } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { computeWalletBalance } from '@/lib/wallet-balance';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;
  const snap = await getDb().collection('walletTransfers').orderBy('date', 'desc').get();
  const transfers = snap.docs.map(d => {
    const data = d.data();
    return { id: d.id, ...data, createdAt: serializeTimestamp(data.createdAt), updatedAt: serializeTimestamp(data.updatedAt) };
  });
  return Response.json({ transfers });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();

  const fromWalletId = typeof data.fromWalletId === 'string' ? data.fromWalletId : '';
  const toWalletId = typeof data.toWalletId === 'string' ? data.toWalletId : '';
  const amount = Number(data.amount) || 0;
  if (!fromWalletId || !toWalletId) return Response.json({ error: 'Dompet asal dan tujuan wajib diisi.' }, { status: 400 });
  if (fromWalletId === toWalletId) return Response.json({ error: 'Dompet asal dan tujuan tidak boleh sama.' }, { status: 400 });
  if (amount <= 0) return Response.json({ error: 'Jumlah transfer harus lebih dari 0.' }, { status: 400 });

  const fromSnap = await db.collection('wallets').doc(fromWalletId).get();
  if (!fromSnap.exists) return Response.json({ error: 'Dompet asal tidak ditemukan.' }, { status: 400 });
  const toSnap = await db.collection('wallets').doc(toWalletId).get();
  if (!toSnap.exists) return Response.json({ error: 'Dompet tujuan tidak ditemukan.' }, { status: 400 });

  const fromBalance = await computeWalletBalance(db, fromWalletId, Number(fromSnap.data()?.initialBalance) || 0);
  if (amount > fromBalance) {
    return Response.json({ error: `Saldo "${fromSnap.data()?.name}" tidak cukup (saldo saat ini Rp${Math.round(fromBalance).toLocaleString('id-ID')}).` }, { status: 400 });
  }

  const payload = {
    fromWalletId, toWalletId, amount,
    date: typeof data.date === 'string' && data.date ? data.date : new Date().toISOString().slice(0, 10),
    note: data.note ?? '',
  };
  const ref = await db.collection('walletTransfers').add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: ref.id,
      entityLabel: `${fromSnap.data()?.name ?? fromWalletId} → ${toSnap.data()?.name ?? toWalletId} - Rp${amount.toLocaleString('id-ID')}`,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers create', err);
  }
  return Response.json({ id: ref.id });
}
