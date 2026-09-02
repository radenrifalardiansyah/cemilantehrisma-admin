export interface WalletRow {
  id: string; name: string; type: string | null; icon: string | null; color: string | null;
  initial_balance: string; is_active: boolean; sort_order: number | null;
  created_at: Date; updated_at: Date | null;
}

export function rowToWallet(r: WalletRow) {
  return {
    id: r.id, name: r.name, type: r.type ?? 'cash', icon: r.icon ?? 'Wallet', color: r.color ?? '#D4691E',
    initialBalance: Number(r.initial_balance) || 0, isActive: r.is_active, order: r.sort_order ?? 0,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}
