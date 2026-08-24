import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb, serializeTimestamp } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { computeWalletBalance } from '@/lib/wallet-balance';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

const getCachedWalletTransfers = unstable_cache(
  async () => {
    const snap = await getDb().collection('walletTransfers').orderBy('date', 'desc').get();
    return snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: serializeTimestamp(data.createdAt), updatedAt: serializeTimestamp(data.updatedAt) };
    });
  },
  ['admin-wallet-transfers'],
  { revalidate: 15 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;
  const transfers = await getCachedWalletTransfers();
  return Response.json({ transfers });
}

// Kegagalan validasi yang diketahui (saldo kurang, dompet tidak ditemukan, dst) — dilempar dari
// dalam transaksi supaya bisa dibedakan dari error tak terduga dan diterjemahkan ke respons 400.
class TransferValidationError extends Error {}

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

  const fromRef = db.collection('wallets').doc(fromWalletId);
  const toRef = db.collection('wallets').doc(toWalletId);
  const payload = {
    fromWalletId, toWalletId, amount,
    date: typeof data.date === 'string' && data.date ? data.date : new Date().toISOString().slice(0, 10),
    note: data.note ?? '',
  };

  let fromName = fromWalletId;
  let toName = toWalletId;
  let transferId: string;
  try {
    // Pengecekan saldo cukup DAN penulisan transfer harus satu transaksi Firestore — kalau
    // terpisah (baca saldo, lalu tulis), dua transfer keluar dari dompet yang sama yang tiba
    // hampir bersamaan bisa sama-sama lolos validasi berdasarkan saldo yang sama, lalu sama-sama
    // commit, membuat saldo dompet minus. Di dalam transaksi, Firestore otomatis me-retry salah
    // satu begitu yang lain lebih dulu commit, sehingga percobaan berikutnya membaca saldo yang
    // sudah memperhitungkan transfer pesaing itu.
    transferId = await db.runTransaction(async tx => {
      const [fromSnap, toSnap] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
      if (!fromSnap.exists) throw new TransferValidationError('Dompet asal tidak ditemukan.');
      if (!toSnap.exists) throw new TransferValidationError('Dompet tujuan tidak ditemukan.');
      fromName = fromSnap.data()?.name ?? fromWalletId;
      toName = toSnap.data()?.name ?? toWalletId;

      const fromBalance = await computeWalletBalance(db, fromWalletId, Number(fromSnap.data()?.initialBalance) || 0, undefined, tx);
      if (amount > fromBalance) {
        throw new TransferValidationError(`Saldo "${fromName}" tidak cukup (saldo saat ini Rp${Math.round(fromBalance).toLocaleString('id-ID')}).`);
      }

      const ref = db.collection('walletTransfers').doc();
      tx.set(ref, { ...payload, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return ref.id;
    });
  } catch (err) {
    if (err instanceof TransferValidationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }

  try {
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: transferId,
      entityLabel: `${fromName} → ${toName} - Rp${amount.toLocaleString('id-ID')}`,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers create', err);
  }
  return Response.json({ id: transferId });
}
