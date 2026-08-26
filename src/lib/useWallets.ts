'use client';

import { useEffect, useState } from 'react';

export interface WalletDoc {
  id: string; name: string; type: 'cash' | 'bank' | 'ewallet' | 'other';
  icon: string; color: string; initialBalance: number; isActive: boolean; order: number;
}

// Dipakai di semua form transaksi (Pemasukan, Pengeluaran, Modal/Prive, Pembelian Bahan
// Baku, POS, Pesanan, Konsinyasi) untuk mengisi dropdown "Dompet" — satu sumber fetch,
// bukan diulang di tiap tab.
export function useWallets(creds: string) {
  const [wallets, setWallets] = useState<WalletDoc[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/wallets', { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<{ wallets: WalletDoc[] }> : Promise.resolve({ wallets: [] }))
      .then(d => { if (!cancelled) setWallets(d.wallets); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [creds]);
  return wallets;
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

// `balances` opsional — kalau dioper (dari useWalletBalances), tiap opsi dompet di dropdown
// ikut menampilkan saldonya (sebagai sublabel SearchSelect) supaya kelihatan langsung saat
// memilih, tanpa harus pilih dulu baru lihat teks "Saldo saat ini" di bawahnya.
export function activeWalletOptions(wallets: WalletDoc[], balances?: Record<string, number>) {
  return wallets.filter(w => w.isActive).map(w => ({
    value: w.id, label: w.name,
    sublabel: balances ? formatRp(balances[w.id] ?? 0) : undefined,
  }));
}

interface BalanceIncomeRow { amount: number; walletId?: string | null }
interface BalanceExpenseRow { amount: number; walletId?: string | null }
interface BalanceCapitalRow { type: 'modal' | 'prive'; amount: number; walletId?: string | null }
interface BalanceOrderRow {
  total?: number; source?: 'kasir' | 'portal'; status?: string;
  paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
}
interface BalanceRecapRow { totalRevenue?: number; paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null }
interface BalanceTransfer { fromWalletId: string; toWalletId: string; amount: number }

// Dipakai di form-form yang MENGURANGI saldo dompet (Pengeluaran, Pembelian Bahan Baku, Prive)
// untuk menampilkan saldo dompet terpilih saat ini, supaya user tahu cukup/tidaknya saldo sebelum
// transaksi disimpan. Tidak dipakai di form yang menambah saldo (Pemasukan, POS, Pesanan,
// Konsinyasi, Modal) karena saldo "sebelum transaksi" tidak relevan di sana. Agregasinya sama
// persis dengan balanceOf() di WalletsTab.tsx & FinanceReportTab.tsx.
export function useWalletBalances(creds: string, wallets: WalletDoc[]) {
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (wallets.length === 0) return;
    let cancelled = false;
    const headers = { 'x-admin-auth': creds };
    const qs = 'from=2000-01-01';
    Promise.all([
      fetch(`/api/income?${qs}`, { headers }),
      fetch(`/api/expenses?${qs}`, { headers }),
      fetch(`/api/capital?${qs}`, { headers }),
      fetch(`/api/orders?${qs}`, { headers }),
      fetch(`/api/consignment/recap?${qs}`, { headers }),
      fetch('/api/wallet-transfers', { headers }),
    ]).then(async ([iRes, eRes, cRes, oRes, rRes, tRes]) => {
      const income: BalanceIncomeRow[] = iRes.ok ? (await iRes.json() as { income: BalanceIncomeRow[] }).income : [];
      const expenses: BalanceExpenseRow[] = eRes.ok ? (await eRes.json() as { expenses: BalanceExpenseRow[] }).expenses : [];
      const capital: BalanceCapitalRow[] = cRes.ok ? (await cRes.json() as { entries: BalanceCapitalRow[] }).entries : [];
      const orders: BalanceOrderRow[] = oRes.ok ? (await oRes.json() as { orders: BalanceOrderRow[] }).orders : [];
      const recaps: BalanceRecapRow[] = rRes.ok ? (await rRes.json() as { recaps: BalanceRecapRow[] }).recaps : [];
      const transfers: BalanceTransfer[] = tRes.ok ? (await tRes.json() as { transfers: BalanceTransfer[] }).transfers : [];
      if (cancelled) return;

      const countedOrders = orders.filter(o =>
        (o.source !== 'portal' || o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
      const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');

      const balanceOf = (walletId: string) => {
        const match = (v: { walletId?: string | null }) => (v.walletId ?? null) === walletId;
        const wallet = wallets.find(w => w.id === walletId);
        const transfersIn = transfers.filter(t => t.toWalletId === walletId).reduce((s, t) => s + t.amount, 0);
        const transfersOut = transfers.filter(t => t.fromWalletId === walletId).reduce((s, t) => s + t.amount, 0);
        return (wallet?.initialBalance ?? 0)
          + income.filter(match).reduce((s, i) => s + i.amount, 0)
          + countedOrders.filter(match).reduce((s, o) => s + (o.total ?? 0), 0)
          + countedRecaps.filter(match).reduce((s, r) => s + (r.totalRevenue ?? 0), 0)
          + transfersIn
          - expenses.filter(match).reduce((s, e) => s + e.amount, 0)
          + capital.filter(c => match(c) && c.type === 'modal').reduce((s, c) => s + c.amount, 0)
          - capital.filter(c => match(c) && c.type === 'prive').reduce((s, c) => s + c.amount, 0)
          - transfersOut;
      };

      const next: Record<string, number> = {};
      wallets.forEach(w => { next[w.id] = balanceOf(w.id); });
      setBalances(next);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [creds, wallets, refreshKey]);
  const refetch = () => setRefreshKey(k => k + 1);
  return [balances, refetch] as const;
}
