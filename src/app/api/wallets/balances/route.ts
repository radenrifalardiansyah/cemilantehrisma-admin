import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Tahap 6 migrasi (lihat plan gleaming-wondering-quokka.md) — pengganti pola lama yang ternyata
// diduplikasi di 3 tempat (useWalletBalances di src/lib/useWallets.ts, WalletsTab.tsx, dan
// FinanceReportTab.tsx "Saldo Kas Saat Ini"): masing-masing fetch SELURUH histori income/expenses/
// capital/orders/consignment-recap/wallet-transfers (from=2000-01-01) lalu hitung saldo di browser.
// Sekarang: 1 endpoint, hitung di server — SEMUA sumber (income/expenses/capital/wallet_transfers/
// orders/consignment_recaps, sejak Tahap 12 & 13) sudah di Postgres, dihitung SQL SUM langsung
// tiap request (murah, tidak ada quota harian di Postgres, jadi selalu fresh tanpa perlu
// cache/invalidasi manual sama sekali).
//
// Ke-6 tabel Postgres digabung jadi SATU query (UNION ALL + SUM ... FILTER) alih-alih beberapa
// query terpisah lewat Promise.all — bukan cuma soal efisiensi (1 round trip), tapi wajib:
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

interface PgTotalsRow {
  wallet_id: string | null;
  initial: string | null;
  income: string | null; expense: string | null;
  modal: string | null; prive: string | null;
  transfer_in: string | null; transfer_out: string | null;
  order_revenue: string | null; recap_revenue: string | null;
}
interface WalletTotals { initial: number; income: number; expense: number; modal: number; prive: number; transferIn: number; transferOut: number; orderRevenue: number; recapRevenue: number }

const EMPTY_TOTALS: WalletTotals = { initial: 0, income: 0, expense: 0, modal: 0, prive: 0, transferIn: 0, transferOut: 0, orderRevenue: 0, recapRevenue: 0 };

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;

  const sql = getSql();

  // `wallets.initial_balance` digabung jadi salah satu "kind" di UNION ALL yang sama (bukan
  // query terpisah) — supaya SETIAP dompet (bahkan yang belum ada transaksi sama sekali) tetap
  // muncul di hasil group-by, dan tidak perlu lagi query daftar dompet secara terpisah.
  const pgRows = await sql<PgTotalsRow[]>`
    select
      wallet_id,
      sum(amount) filter (where kind = 'initial') as initial,
      sum(amount) filter (where kind = 'income') as income,
      sum(amount) filter (where kind = 'expense') as expense,
      sum(amount) filter (where kind = 'modal') as modal,
      sum(amount) filter (where kind = 'prive') as prive,
      sum(amount) filter (where kind = 'transfer_in') as transfer_in,
      sum(amount) filter (where kind = 'transfer_out') as transfer_out,
      sum(amount) filter (where kind = 'order_revenue') as order_revenue,
      sum(amount) filter (where kind = 'recap_revenue') as recap_revenue
    from (
      select id as wallet_id, initial_balance as amount, 'initial' as kind from wallets
      union all
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
      union all
      select wallet_id, total as amount, 'order_revenue' as kind from orders
        where status != 'baru' and payment_status != 'belum_lunas' and status != 'dibatalkan'
      union all
      select wallet_id, total_revenue as amount, 'recap_revenue' as kind from consignment_recaps
        where payment_status != 'belum_lunas'
    ) combined
    group by wallet_id
  `;

  const pgByWallet = new Map<string, WalletTotals>();
  let pgUnassigned: WalletTotals = EMPTY_TOTALS;
  pgRows.forEach(r => {
    const totals: WalletTotals = {
      initial: Number(r.initial) || 0,
      income: Number(r.income) || 0, expense: Number(r.expense) || 0,
      modal: Number(r.modal) || 0, prive: Number(r.prive) || 0,
      transferIn: Number(r.transfer_in) || 0, transferOut: Number(r.transfer_out) || 0,
      orderRevenue: Number(r.order_revenue) || 0, recapRevenue: Number(r.recap_revenue) || 0,
    };
    if (r.wallet_id) pgByWallet.set(r.wallet_id, totals);
    else pgUnassigned = totals;
  });

  const balances: Record<string, number> = {};
  pgByWallet.forEach((t, id) => {
    balances[id] = t.initial
      + t.income + t.modal + t.transferIn + t.orderRevenue + t.recapRevenue
      - t.expense - t.prive - t.transferOut;
  });

  const unassigned = pgUnassigned.income + pgUnassigned.modal + pgUnassigned.orderRevenue + pgUnassigned.recapRevenue
    - pgUnassigned.expense - pgUnassigned.prive;

  let totalTx = 0;
  for (const t of [...pgByWallet.values(), pgUnassigned]) {
    totalTx += t.income + t.modal + t.orderRevenue + t.recapRevenue - t.expense - t.prive;
  }

  return Response.json({ balances, unassigned, totalTx });
}
