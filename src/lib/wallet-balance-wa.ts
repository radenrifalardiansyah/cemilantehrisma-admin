import { SHOPPING_WA_DEFAULT_STORE, plainText } from './shopping-wa';
import { formatDate, formatRp } from './format';

// Pesan WA "Saldo Dompet" ke nomor WA toko sendiri: daftar dompet + saldo + total. Murni (tanpa DB/HTTP) supaya aman
// di klien dan bisa diuji. ASCII murni dan tanpa blok monospace (alasan sama dengan shopping-wa.ts).

export interface WalletBalanceItem { name: string; balance: number; isActive?: boolean }

const WEEKDAY = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' });

/** scope 'semua' = seluruh dompet aktif yang diberikan; 'terpilih' = dompet yang dicentang (nonaktif pun ikut, ditandai). */
export function buildWalletBalanceWaMessage(
  wallets: WalletBalanceItem[], opts: { storeName?: string; scope?: 'semua' | 'terpilih'; now?: Date } = {},
): string {
  const store = opts.storeName?.trim() || SHOPPING_WA_DEFAULT_STORE;
  const now = opts.now ?? new Date();
  const scope = opts.scope ?? 'semua';
  const when = `${WEEKDAY.format(now)}, ${formatDate(now, 'datetime', 'Asia/Jakarta')} WIB`;
  const lines: string[] = [
    `*SALDO DOMPET - ${store}*`,
    `Per: ${when}`,
    scope === 'semua' ? 'Dompet: semua dompet aktif' : `Dompet: ${wallets.length} dompet terpilih`,
    '',
  ];
  let total = 0;
  wallets.forEach((w, i) => {
    total += w.balance;
    lines.push(`${i + 1}. ${w.name.trim() || '-'}${w.isActive === false ? ' (nonaktif)' : ''}: ${formatRp(w.balance)}`);
  });
  lines.push('', `*Total saldo: ${formatRp(total)}*`);
  return plainText(lines.join('\n'));
}
