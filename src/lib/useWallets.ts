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

export function activeWalletOptions(wallets: WalletDoc[]) {
  return wallets.filter(w => w.isActive).map(w => ({ value: w.id, label: w.name }));
}
