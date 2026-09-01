import type { Firestore, Query, Transaction } from 'firebase-admin/firestore';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';

// ISql: interface bersama Sql (koneksi pool) & TransactionSql (di dalam sql.begin(...)) — dipakai
// supaya computeWalletBalance bisa menerima keduanya, tanpa butuh .begin()/.end() yang cuma ada
// di Sql penuh.
type PgClient = postgres.ISql<{}>;

// `capitalEntries`, `walletTransfers` & `income` pindah ke Postgres (Tahap 2-4 migrasi, lihat
// plan gleaming-wondering-quokka.md) — makanya dicek terpisah dari koleksi Firestore lain di bawah.
const WALLET_ID_COLLECTIONS = ['expenses', 'materialPurchases', 'orders', 'consignmentRecaps'];

// Dipakai oleh DELETE satuan dan bulk-delete dompet — dompet dengan riwayat transaksi (termasuk
// jadi asal/tujuan transfer) tidak boleh dihapus permanen, harus dinonaktifkan saja, supaya
// dokumen lama yang masih menyimpan walletId ini tidak jadi anak yatim.
export async function walletHasReferences(db: Firestore, walletId: string): Promise<boolean> {
  const sql = getSql();
  const [checks, [row]] = await Promise.all([
    Promise.all(WALLET_ID_COLLECTIONS.map(col => db.collection(col).where('walletId', '==', walletId).limit(1).get())),
    sql<{ exists: boolean }[]>`
      select
        exists(select 1 from capital_entries where wallet_id = ${walletId})
        or exists(select 1 from wallet_transfers where from_wallet_id = ${walletId} or to_wallet_id = ${walletId})
        or exists(select 1 from income where wallet_id = ${walletId})
        as exists
    `,
  ]);
  return checks.some(snap => !snap.empty) || Boolean(row.exists);
}

// Satu-satunya tempat menghitung saldo dompet di server — dipakai untuk validasi Transfer
// Antar Dompet (supaya tidak bisa transfer melebihi saldo yang benar-benar ada). Sengaja hanya
// query `where('walletId', '==', ...)` (single-field, otomatis ter-index Firestore) lalu filter
// status/tipe di JS, supaya tidak perlu index komposit tambahan — sama seperti pola agregasi
// client-side yang sudah dipakai WalletsTab.tsx & FinanceReportTab.tsx.
//
// `tx`: bila diberikan, query Firestore (income/expenses/orders/consignmentRecaps — yang belum
// pindah ke Postgres) dibaca lewat `tx.get()` alih-alih `.get()` biasa, supaya pemanggil bisa
// membungkus pengecekan saldo + penulisan dalam SATU transaksi Firestore.
//
// `pgTx`: bila diberikan (dari `sql.begin(...)` di caller), query capital_entries/wallet_transfers
// dijalankan di dalam transaksi Postgres itu alih-alih koneksi pool biasa — dipakai wallet-transfers
// route untuk mengunci baris (`pg_advisory_xact_lock`) supaya dua transfer keluar yang tiba
// bersamaan dari dompet yang sama tidak lolos validasi berdasarkan saldo yang sama (TOCTOU).
// Tanpa `pgTx`, baca capital/transfer ini best-effort di luar transaksi manapun — trade-off yang
// diterima untuk kombinasi data yang masih tersebar Firestore+Postgres selama migrasi bertahap.
export async function computeWalletBalance(
  db: Firestore,
  walletId: string,
  initialBalance: number,
  excludeTransferId?: string,
  tx?: Transaction,
  pgTx?: PgClient,
): Promise<number> {
  const read = <T>(q: Query<T>) => (tx ? tx.get(q) : q.get());
  const sql = pgTx ?? getSql();
  const [expensesSnap, [pgTotals], ordersSnap, recapsSnap] = await Promise.all([
    read(db.collection('expenses').where('walletId', '==', walletId)),
    sql<{ total_modal: string; total_prive: string; total_in: string; total_out: string; total_income: string }[]>`
      select
        coalesce((select sum(amount) from capital_entries where wallet_id = ${walletId} and type = 'modal'), 0) as total_modal,
        coalesce((select sum(amount) from capital_entries where wallet_id = ${walletId} and type = 'prive'), 0) as total_prive,
        coalesce((select sum(amount) from wallet_transfers where to_wallet_id = ${walletId} and id != ${excludeTransferId ?? ''}), 0) as total_in,
        coalesce((select sum(amount) from wallet_transfers where from_wallet_id = ${walletId} and id != ${excludeTransferId ?? ''}), 0) as total_out,
        coalesce((select sum(amount) from income where wallet_id = ${walletId}), 0) as total_income
    `,
    read(db.collection('orders').where('walletId', '==', walletId)),
    read(db.collection('consignmentRecaps').where('walletId', '==', walletId)),
  ]);

  const totalIncome = Number(pgTotals.total_income) || 0;
  const totalExpenses = expensesSnap.docs.reduce((s, d) => s + (Number(d.data().amount) || 0), 0);
  const totalModal = Number(pgTotals.total_modal) || 0;
  const totalPrive = Number(pgTotals.total_prive) || 0;
  const totalOrders = ordersSnap.docs
    .map(d => d.data())
    .filter(o => (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  const totalRecaps = recapsSnap.docs
    .map(d => d.data())
    .filter(r => r.paymentStatus !== 'belum_lunas')
    .reduce((s, r) => s + (Number(r.totalRevenue) || 0), 0);
  const totalTransfersIn = Number(pgTotals.total_in) || 0;
  const totalTransfersOut = Number(pgTotals.total_out) || 0;

  return initialBalance + totalIncome + totalOrders + totalRecaps + totalModal + totalTransfersIn
    - totalExpenses - totalPrive - totalTransfersOut;
}
