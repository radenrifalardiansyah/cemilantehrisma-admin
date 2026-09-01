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

// Dipakai di form-form yang MENGURANGI saldo dompet (Pengeluaran, Pembelian Bahan Baku, Prive)
// untuk menampilkan saldo dompet terpilih saat ini, supaya user tahu cukup/tidaknya saldo sebelum
// transaksi disimpan. Tidak dipakai di form yang menambah saldo (Pemasukan, POS, Pesanan,
// Konsinyasi, Modal) karena saldo "sebelum transaksi" tidak relevan di sana.
//
// Tahap 6 migrasi (lihat plan gleaming-wondering-quokka.md) — dulu di sini fetch SELURUH histori
// dari 6 endpoint (from=2000-01-01) lalu hitung saldo tiap dompet sendiri di client; sekarang 1
// fetch ke /api/wallets/balances yang sudah menghitung semuanya di server (SQL SUM untuk bagian
// yang sudah di Postgres, jauh lebih murah daripada tarik semua baris histori ke browser).
export function useWalletBalances(creds: string, wallets: WalletDoc[]) {
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (wallets.length === 0) return;
    let cancelled = false;
    fetch('/api/wallets/balances', { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<{ balances: Record<string, number> }> : Promise.resolve({ balances: {} }))
      .then(d => { if (!cancelled) setBalances(d.balances); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [creds, wallets, refreshKey]);
  const refetch = () => setRefreshKey(k => k + 1);
  return [balances, refetch] as const;
}
