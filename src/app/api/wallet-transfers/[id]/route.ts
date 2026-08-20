import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { computeWalletBalance } from '@/lib/wallet-balance';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = db.collection('walletTransfers').doc(id);
  const existing = await ref.get();
  if (!existing.exists) return Response.json({ error: 'Transfer tidak ditemukan.' }, { status: 404 });
  const before = existing.data();

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

  // Hitung saldo dompet asal TANPA transfer ini (excludeTransferId) — supaya edit transfer yang
  // sama (mis. cuma ganti catatan) tidak keblokir oleh kontribusi transfer itu sendiri.
  const fromBalance = await computeWalletBalance(db, fromWalletId, Number(fromSnap.data()?.initialBalance) || 0, id);
  if (amount > fromBalance) {
    return Response.json({ error: `Saldo "${fromSnap.data()?.name}" tidak cukup (saldo saat ini Rp${Math.round(fromBalance).toLocaleString('id-ID')}).` }, { status: 400 });
  }

  const payload = {
    fromWalletId, toWalletId, amount,
    date: typeof data.date === 'string' && data.date ? data.date : before?.date,
    note: data.note ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.update(payload);
  try {
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: id,
      entityLabel: `${fromSnap.data()?.name ?? fromWalletId} → ${toSnap.data()?.name ?? toWalletId} - Rp${amount.toLocaleString('id-ID')}`,
      action: 'update',
      actor: guard,
      before,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers update', err);
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const ref = db.collection('walletTransfers').doc(id);
  const existing = await ref.get();
  const before = existing.data();
  await ref.delete();
  try {
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: id,
      entityLabel: before ? `Rp${Number(before.amount ?? 0).toLocaleString('id-ID')}` : id,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers delete', err);
  }
  return Response.json({ ok: true });
}
