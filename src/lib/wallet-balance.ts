import type { Firestore } from 'firebase-admin/firestore';

const WALLET_ID_COLLECTIONS = ['income', 'expenses', 'capitalEntries', 'materialPurchases', 'orders', 'consignmentRecaps'];

// Dipakai oleh DELETE satuan dan bulk-delete dompet — dompet dengan riwayat transaksi (termasuk
// jadi asal/tujuan transfer) tidak boleh dihapus permanen, harus dinonaktifkan saja, supaya
// dokumen lama yang masih menyimpan walletId ini tidak jadi anak yatim.
export async function walletHasReferences(db: Firestore, walletId: string): Promise<boolean> {
  const checks = await Promise.all([
    ...WALLET_ID_COLLECTIONS.map(col => db.collection(col).where('walletId', '==', walletId).limit(1).get()),
    db.collection('walletTransfers').where('fromWalletId', '==', walletId).limit(1).get(),
    db.collection('walletTransfers').where('toWalletId', '==', walletId).limit(1).get(),
  ]);
  return checks.some(snap => !snap.empty);
}

// Satu-satunya tempat menghitung saldo dompet di server — dipakai untuk validasi Transfer
// Antar Dompet (supaya tidak bisa transfer melebihi saldo yang benar-benar ada). Sengaja hanya
// query `where('walletId', '==', ...)` (single-field, otomatis ter-index Firestore) lalu filter
// status/tipe di JS, supaya tidak perlu index komposit tambahan — sama seperti pola agregasi
// client-side yang sudah dipakai WalletsTab.tsx & FinanceReportTab.tsx.
export async function computeWalletBalance(
  db: Firestore,
  walletId: string,
  initialBalance: number,
  excludeTransferId?: string,
): Promise<number> {
  const [incomeSnap, expensesSnap, capitalSnap, ordersSnap, recapsSnap, transfersInSnap, transfersOutSnap] = await Promise.all([
    db.collection('income').where('walletId', '==', walletId).get(),
    db.collection('expenses').where('walletId', '==', walletId).get(),
    db.collection('capitalEntries').where('walletId', '==', walletId).get(),
    db.collection('orders').where('walletId', '==', walletId).get(),
    db.collection('consignmentRecaps').where('walletId', '==', walletId).get(),
    db.collection('walletTransfers').where('toWalletId', '==', walletId).get(),
    db.collection('walletTransfers').where('fromWalletId', '==', walletId).get(),
  ]);

  const totalIncome = incomeSnap.docs.reduce((s, d) => s + (Number(d.data().amount) || 0), 0);
  const totalExpenses = expensesSnap.docs.reduce((s, d) => s + (Number(d.data().amount) || 0), 0);
  const totalModal = capitalSnap.docs.filter(d => d.data().type === 'modal').reduce((s, d) => s + (Number(d.data().amount) || 0), 0);
  const totalPrive = capitalSnap.docs.filter(d => d.data().type === 'prive').reduce((s, d) => s + (Number(d.data().amount) || 0), 0);
  const totalOrders = ordersSnap.docs
    .map(d => d.data())
    .filter(o => (o.source !== 'portal' || o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  const totalRecaps = recapsSnap.docs
    .map(d => d.data())
    .filter(r => r.paymentStatus !== 'belum_lunas')
    .reduce((s, r) => s + (Number(r.totalRevenue) || 0), 0);
  const totalTransfersIn = transfersInSnap.docs
    .filter(d => d.id !== excludeTransferId)
    .reduce((s, d) => s + (Number(d.data().amount) || 0), 0);
  const totalTransfersOut = transfersOutSnap.docs
    .filter(d => d.id !== excludeTransferId)
    .reduce((s, d) => s + (Number(d.data().amount) || 0), 0);

  return initialBalance + totalIncome + totalOrders + totalRecaps + totalModal + totalTransfersIn
    - totalExpenses - totalPrive - totalTransfersOut;
}
