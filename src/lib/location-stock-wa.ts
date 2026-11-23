import { SHOPPING_WA_DEFAULT_STORE, plainText } from './shopping-wa';
import { formatDate } from './format';

// Pesan WA "Sisa Stok di Mitra" ke nomor WA toko sendiri: per mitra yang dipilih, produk dan sisa pcs-nya, plus total per
// produk dan total semua. Murni (tanpa DB/HTTP) supaya aman di klien dan bisa diuji. ASCII murni dan tanpa blok monospace.

export interface LocationStockInput {
  locationName: string;
  stock: { productId: string; productName: string; stockQty: number }[];
}

const qtyLabel = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const WEEKDAY = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' });

export function buildLocationStockWaMessage(locations: LocationStockInput[], opts: { storeName?: string; now?: Date } = {}): string {
  const store = opts.storeName?.trim() || SHOPPING_WA_DEFAULT_STORE;
  const now = opts.now ?? new Date();
  const lines: string[] = [
    `*SISA STOK DI MITRA - ${store}*`,
    `Per: ${WEEKDAY.format(now)}, ${formatDate(now, 'datetime', 'Asia/Jakarta')} WIB`,
    `Jumlah mitra: ${locations.length}`,
  ];
  const perProduct = new Map<string, { name: string; qty: number }>();
  let grand = 0;
  locations.forEach((l, i) => {
    lines.push('', `${i + 1}. *${l.locationName.trim() || '-'}*`);
    const items = l.stock.filter(s => s.stockQty > 0);
    if (items.length === 0) { lines.push('   Stok kosong'); return; }
    let sub = 0;
    for (const s of items) {
      lines.push(`   - ${s.productName.trim()}: ${qtyLabel(s.stockQty)} pcs`);
      sub += s.stockQty;
      const k = s.productId || `n:${s.productName.trim().toLowerCase()}`;
      const p = perProduct.get(k) ?? { name: s.productName.trim(), qty: 0 };
      p.qty += s.stockQty;
      perProduct.set(k, p);
    }
    lines.push(`   Subtotal: ${qtyLabel(sub)} pcs`);
    grand += sub;
  });
  if (perProduct.size > 0) {
    lines.push('', '*TOTAL PER PRODUK*');
    [...perProduct.values()].sort((a, b) => a.name.localeCompare(b.name, 'id')).forEach(p => lines.push(`- ${p.name}: ${qtyLabel(p.qty)} pcs`));
  }
  lines.push('', `*Total semua: ${qtyLabel(grand)} pcs*`);
  return plainText(lines.join('\n'));
}
