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

interface GroupedSum { wallet_id: string | null; total: string }

async function groupedSum(query: Promise<GroupedSum[]>) {
  const rows = await query;
  const map = new Map<string, number>();
  rows.forEach(r => { if (r.wallet_id) map.set(r.wallet_id, Number(r.total) || 0); });
  return map;
}

async function scalarSum(query: Promise<{ total: string | null }[]>) {
  const [row] = await query;
  return Number(row?.total) || 0;
}

const sumOfMap = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;

  const db = getDb();
  const sql = getSql();

  const [
    walletsSnap, ordersRecaps,
    incomeByWallet, expensesByWallet, modalByWallet, priveByWallet, transfersInByWallet, transfersOutByWallet,
    incomeNull, expensesNull, modalNull, priveNull,
  ] = await Promise.all([
    db.collection('wallets').get(),
    getCachedOrdersRecapsByWallet(),
    groupedSum(sql<GroupedSum[]>`select wallet_id, sum(amount) as total from income where wallet_id is not null group by wallet_id`),
    groupedSum(sql<GroupedSum[]>`select wallet_id, sum(amount) as total from expenses where wallet_id is not null group by wallet_id`),
    groupedSum(sql<GroupedSum[]>`select wallet_id, sum(amount) as total from capital_entries where wallet_id is not null and type = 'modal' group by wallet_id`),
    groupedSum(sql<GroupedSum[]>`select wallet_id, sum(amount) as total from capital_entries where wallet_id is not null and type = 'prive' group by wallet_id`),
    groupedSum(sql<GroupedSum[]>`select to_wallet_id as wallet_id, sum(amount) as total from wallet_transfers group by to_wallet_id`),
    groupedSum(sql<GroupedSum[]>`select from_wallet_id as wallet_id, sum(amount) as total from wallet_transfers group by from_wallet_id`),
    scalarSum(sql<{ total: string | null }[]>`select sum(amount) as total from income where wallet_id is null`),
    scalarSum(sql<{ total: string | null }[]>`select sum(amount) as total from expenses where wallet_id is null`),
    scalarSum(sql<{ total: string | null }[]>`select sum(amount) as total from capital_entries where wallet_id is null and type = 'modal'`),
    scalarSum(sql<{ total: string | null }[]>`select sum(amount) as total from capital_entries where wallet_id is null and type = 'prive'`),
  ]);

  const ordersByWallet = new Map(ordersRecaps.orders);
  const recapsByWallet = new Map(ordersRecaps.recaps);

  const balances: Record<string, number> = {};
  walletsSnap.docs.forEach(d => {
    const id = d.id;
    const initialBalance = Number(d.data().initialBalance) || 0;
    balances[id] = initialBalance
      + (incomeByWallet.get(id) ?? 0)
      + (ordersByWallet.get(id) ?? 0)
      + (recapsByWallet.get(id) ?? 0)
      + (modalByWallet.get(id) ?? 0)
      + (transfersInByWallet.get(id) ?? 0)
      - (expensesByWallet.get(id) ?? 0)
      - (priveByWallet.get(id) ?? 0)
      - (transfersOutByWallet.get(id) ?? 0);
  });

  const unassigned = incomeNull + ordersRecaps.ordersUnassigned + ordersRecaps.recapsUnassigned + modalNull - expensesNull - priveNull;

  const totalTx =
    (sumOfMap(incomeByWallet) + incomeNull)
    + (sumOfMap(ordersByWallet) + ordersRecaps.ordersUnassigned)
    + (sumOfMap(recapsByWallet) + ordersRecaps.recapsUnassigned)
    + (sumOfMap(modalByWallet) + modalNull)
    - (sumOfMap(expensesByWallet) + expensesNull)
    - (sumOfMap(priveByWallet) + priveNull);

  return Response.json({ balances, unassigned, totalTx });
}
