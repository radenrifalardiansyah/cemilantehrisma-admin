import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Tahap 6 migrasi (lihat plan gleaming-wondering-quokka.md) — pengganti pola lama yang ternyata
// diduplikasi di 3 tempat (useWalletBalances di src/lib/useWallets.ts, WalletsTab.tsx, dan
// FinanceReportTab.tsx "Saldo Kas Saat Ini"): masing-masing fetch SELURUH histori income/expenses/
// capital/orders/consignment-recap/wallet-transfers (from=2000-01-01) lalu hitung saldo di browser.
// Sekarang: 1 endpoint, hitung di server — bagian yang sudah di Postgres (income/expenses/capital/
// wallet_transfers) dihitung SQL SUM langsung tiap request (murah, tidak ada quota harian di
// Postgres, jadi selalu fresh tanpa perlu cache/invalidasi manual). Bagian yang masih di Firestore
// (orders/consignmentRecaps) tetap di-cache 15 detik seperti pola lain di app ini, supaya tidak
// menambah beban baca Firestore.
//
// Ke-4 tabel Postgres digabung jadi SATU query (UNION ALL + SUM ... FILTER) alih-alih 6 query
// terpisah lewat Promise.all — bukan cuma soal efisiensi (1 round trip, bukan 6), tapi wajib:
// beberapa query Postgres konkuren lewat 1 koneksi pool bergantung pada pipelining postgres.js,
// dan pipelining itu terbukti macet total (bukan cuma lambat) lewat PgBouncer transaction-mode
// Supabase — lihat komentar di src/lib/db.ts. 1 query = tidak ada yang perlu dipipeline sama sekali.
//
// Response:
// - `balances`: saldo per walletId (initialBalance dompet + semua transaksi milik dompet itu).
// - `unassigned`: entri lama tanpa walletId (dari sebelum fitur Dompet ada) — dipakai WalletsTab &
//   FinanceReportTab untuk bucket "Belum Ditentukan". Transfer antar dompet tidak pernah masuk
//   sini (selalu antara 2 dompet nyata).
// - `totalTx`: total transaksi SEMUA dompet + unassigned digabung, TANPA initialBalance dompet
//   manapun dan TANPA transfer (saling meniadakan kalau dijumlah semua dompet) — dipakai
//   FinanceReportTab untuk "allTimeTxSaldo" (ditambah `saldoAwal` terpisah di sana).

interface OrderDoc {
  total?: number; status?: string; paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
}
interface RecapDoc {
  totalRevenue?: number; paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
}

const getCachedOrdersRecapsByWallet = unstable_cache(
  async () => {
    const db = getDb();
    const [orderSnap, recapSnap] = await Promise.all([
      db.collection('orders').get(),
      db.collection('consignmentRecaps').get(),
    ]);
    const ordersByWallet = new Map<string, number>();
    let ordersUnassigned = 0;
    orderSnap.docs.map(d => d.data() as OrderDoc)
      .filter(o => (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan')
      .forEach(o => {
        if (!o.walletId) { ordersUnassigned += o.total ?? 0; return; }
        ordersByWallet.set(o.walletId, (ordersByWallet.get(o.walletId) ?? 0) + (o.total ?? 0));
      });
    const recapsByWallet = new Map<string, number>();
    let recapsUnassigned = 0;
    recapSnap.docs.map(d => d.data() as RecapDoc)
      .filter(r => r.paymentStatus !== 'belum_lunas')
      .forEach(r => {
        if (!r.walletId) { recapsUnassigned += r.totalRevenue ?? 0; return; }
        recapsByWallet.set(r.walletId, (recapsByWallet.get(r.walletId) ?? 0) + (r.totalRevenue ?? 0));
      });
    return { orders: [...ordersByWallet.entries()], recaps: [...recapsByWallet.entries()], ordersUnassigned, recapsUnassigned };
  },
  ['admin-wallet-balances-orders-recaps'],
  { revalidate: 15 },
);

interface PgTotalsRow {
  wallet_id: string | null;
  income: string | null; expense: string | null;
  modal: string | null; prive: string | null;
  transfer_in: string | null; transfer_out: string | null;
}
interface WalletTotals { income: number; expense: number; modal: number; prive: number; transferIn: number; transferOut: number }

const EMPTY_TOTALS: WalletTotals = { income: 0, expense: 0, modal: 0, prive: 0, transferIn: 0, transferOut: 0 };

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;

  const db = getDb();
  const sql = getSql();

  const [walletsSnap, ordersRecaps, pgRows] = await Promise.all([
    db.collection('wallets').get(),
    getCachedOrdersRecapsByWallet(),
    sql<PgTotalsRow[]>`
      select
        wallet_id,
        sum(amount) filter (where kind = 'income') as income,
        sum(amount) filter (where kind = 'expense') as expense,
        sum(amount) filter (where kind = 'modal') as modal,
        sum(amount) filter (where kind = 'prive') as prive,
        sum(amount) filter (where kind = 'transfer_in') as transfer_in,
        sum(amount) filter (where kind = 'transfer_out') as transfer_out
      from (
        select wallet_id, amount, 'income' as kind from income
        union all
        select wallet_id, amount, 'expense' as kind from expenses
        union all
        select wallet_id, amount, 'modal' as kind from capital_entries where type = 'modal'
        union all
        select wallet_id, amount, 'prive' as kind from capital_entries where type = 'prive'
        union all
        select to_wallet_id as wallet_id, amount, 'transfer_in' as kind from wallet_transfers
        union all
        select from_wallet_id as wallet_id, amount, 'transfer_out' as kind from wallet_transfers
      ) combined
      group by wallet_id
    `,
  ]);

  const pgByWallet = new Map<string, WalletTotals>();
  let pgUnassigned: WalletTotals = EMPTY_TOTALS;
  pgRows.forEach(r => {
    const totals: WalletTotals = {
      income: Number(r.income) || 0, expense: Number(r.expense) || 0,
      modal: Number(r.modal) || 0, prive: Number(r.prive) || 0,
      transferIn: Number(r.transfer_in) || 0, transferOut: Number(r.transfer_out) || 0,
    };
    if (r.wallet_id) pgByWallet.set(r.wallet_id, totals);
    else pgUnassigned = totals;
  });

  const ordersByWallet = new Map(ordersRecaps.orders);
  const recapsByWallet = new Map(ordersRecaps.recaps);

  const balances: Record<string, number> = {};
  walletsSnap.docs.forEach(d => {
    const id = d.id;
    const initialBalance = Number(d.data().initialBalance) || 0;
    const t = pgByWallet.get(id) ?? EMPTY_TOTALS;
    balances[id] = initialBalance
      + t.income + t.modal + t.transferIn
      + (ordersByWallet.get(id) ?? 0) + (recapsByWallet.get(id) ?? 0)
      - t.expense - t.prive - t.transferOut;
  });

  const unassigned = pgUnassigned.income + pgUnassigned.modal - pgUnassigned.expense - pgUnassigned.prive
    + ordersRecaps.ordersUnassigned + ordersRecaps.recapsUnassigned;

  let totalTx = ordersRecaps.ordersUnassigned + ordersRecaps.recapsUnassigned;
  for (const t of [...pgByWallet.values(), pgUnassigned]) {
    totalTx += t.income + t.modal - t.expense - t.prive;
  }
  for (const v of ordersByWallet.values()) totalTx += v;
  for (const v of recapsByWallet.values()) totalTx += v;

  return Response.json({ balances, unassigned, totalTx });
}
