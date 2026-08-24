import type { Firestore, Query, Transaction } from 'firebase-admin/firestore';

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
//
// `tx`: bila diberikan, semua query dibaca lewat `tx.get()` alih-alih `.get()` biasa, supaya
// pemanggil bisa membungkus pengecekan saldo + penulisan transfer dalam SATU transaksi Firestore.
// Tanpa ini, dua transfer keluar yang tiba bersamaan bisa lolos validasi berdasarkan saldo yang
// sama lalu sama-sama commit, membuat saldo dompet minus (TOCTOU) — dengan `tx`, Firestore
// otomatis me-retry salah satu transaksi begitu transfer pesaingnya lebih dulu commit, sehingga
// baca-ulang saldo di percobaan berikutnya sudah memperhitungkan transfer itu.
export async function computeWalletBalance(
  db: Firestore,
  walletId: string,
  initialBalance: number,
  excludeTransferId?: string,
  tx?: Transaction,
): Promise<number> {
  const read = <T>(q: Query<T>) => (tx ? tx.get(q) : q.get());
  const [incomeSnap, expensesSnap, capitalSnap, ordersSnap, recapsSnap, transfersInSnap, transfersOutSnap] = await Promise.all([
    read(db.collection('income').where('walletId', '==', walletId)),
    read(db.collection('expenses').where('walletId', '==', walletId)),
    read(db.collection('capitalEntries').where('walletId', '==', walletId)),
    read(db.collection('orders').where('walletId', '==', walletId)),
    read(db.collection('consignmentRecaps').where('walletId', '==', walletId)),
    read(db.collection('walletTransfers').where('toWalletId', '==', walletId)),
    read(db.collection('walletTransfers').where('fromWalletId', '==', walletId)),
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
