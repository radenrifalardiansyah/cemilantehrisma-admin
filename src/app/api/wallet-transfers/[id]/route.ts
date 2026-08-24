import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { computeWalletBalance } from '@/lib/wallet-balance';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

class TransferValidationError extends Error {}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = db.collection('walletTransfers').doc(id);

  const fromWalletId = typeof data.fromWalletId === 'string' ? data.fromWalletId : '';
  const toWalletId = typeof data.toWalletId === 'string' ? data.toWalletId : '';
  const amount = Number(data.amount) || 0;
  if (!fromWalletId || !toWalletId) return Response.json({ error: 'Dompet asal dan tujuan wajib diisi.' }, { status: 400 });
  if (fromWalletId === toWalletId) return Response.json({ error: 'Dompet asal dan tujuan tidak boleh sama.' }, { status: 400 });
  if (amount <= 0) return Response.json({ error: 'Jumlah transfer harus lebih dari 0.' }, { status: 400 });

  const fromRef = db.collection('wallets').doc(fromWalletId);
  const toRef = db.collection('wallets').doc(toWalletId);

  let before: FirebaseFirestore.DocumentData | undefined;
  let fromName = fromWalletId;
  let toName = toWalletId;
  let payload: Record<string, unknown>;
  try {
    // Sama seperti POST /api/wallet-transfers: pengecekan saldo dan penulisan update harus satu
    // transaksi, supaya edit yang tiba bersamaan dengan transfer lain dari dompet yang sama tidak
    // lolos validasi berdasarkan saldo yang sudah basi (TOCTOU).
    payload = await db.runTransaction(async tx => {
      const [existing, fromSnap, toSnap] = await Promise.all([tx.get(ref), tx.get(fromRef), tx.get(toRef)]);
      if (!existing.exists) throw new TransferValidationError('Transfer tidak ditemukan.');
      before = existing.data();
      if (!fromSnap.exists) throw new TransferValidationError('Dompet asal tidak ditemukan.');
      if (!toSnap.exists) throw new TransferValidationError('Dompet tujuan tidak ditemukan.');
      fromName = fromSnap.data()?.name ?? fromWalletId;
      toName = toSnap.data()?.name ?? toWalletId;

      // Hitung saldo dompet asal TANPA transfer ini (excludeTransferId) — supaya edit transfer
      // yang sama (mis. cuma ganti catatan) tidak keblokir oleh kontribusi transfer itu sendiri.
      const fromBalance = await computeWalletBalance(db, fromWalletId, Number(fromSnap.data()?.initialBalance) || 0, id, tx);
      if (amount > fromBalance) {
        throw new TransferValidationError(`Saldo "${fromName}" tidak cukup (saldo saat ini Rp${Math.round(fromBalance).toLocaleString('id-ID')}).`);
      }

      const update = {
        fromWalletId, toWalletId, amount,
        date: typeof data.date === 'string' && data.date ? data.date : before?.date,
        note: data.note ?? '',
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.update(ref, update);
      return update;
    });
  } catch (err) {
    if (err instanceof TransferValidationError) {
      const status = err.message === 'Transfer tidak ditemukan.' ? 404 : 400;
      return Response.json({ error: err.message }, { status });
    }
    throw err;
  }

  try {
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: id,
      entityLabel: `${fromName} → ${toName} - Rp${amount.toLocaleString('id-ID')}`,
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
