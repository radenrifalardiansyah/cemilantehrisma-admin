import { formatRp, formatDate } from './format';
import { normalizePhone } from './phone';

// Kirim WA Daftar Belanja (ke nomor WA toko): pembentuk pesan + URL wa.me. Murni (tanpa DB/HTTP/modul server) supaya aman di klien
// dan bisa diuji. Pesan dijaga ASCII murni (emoji/en-em dash/spasi tak terputus dirender sebagai karakter rusak di
// sebagian klien WA) dan tanpa blok monospace (tiga backtick) karena font monospace WhatsApp Android melebarkan digit.

// Sama dengan DEFAULT_STORE_NAME di closing-wa.ts (modul itu memakai node:crypto, tidak boleh diimpor klien).
export const SHOPPING_WA_DEFAULT_STORE = 'Cemilan Teh Risma';

export interface ShoppingWaItem {
  materialName: string; unit: string; qty: number; price: number | null;
  status: 'pending' | 'done';
}

export interface ShoppingWaGroup {
  date: string; // YYYY-MM-DD
  supplierName: string;
  /** true bila supplier terdaftar (label "Supplier"); false = toko/warung lain (label "Toko"). */
  registeredSupplier: boolean;
  items: ShoppingWaItem[];
  notes: string[];
}

export const plainText = (t: string): string =>
  t.replace(/[  ]/g, ' ').replace(/[–—]/g, '-').replace(/[^\x0a\x20-\x7e]/g, '');

const qtyLabel = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

export function buildShoppingWaMessage(g: ShoppingWaGroup, opts: { storeName?: string; pdfUrl?: string } = {}): string {
  const store = opts.storeName?.trim() || SHOPPING_WA_DEFAULT_STORE;
  const pending = g.items.filter(i => i.status === 'pending');
  // Daftar yang masih punya item belum dibeli hanya mengirim sisanya; bila semua selesai, kirim semuanya.
  const items = pending.length > 0 ? pending : g.items;
  const lines: string[] = [
    `*DAFTAR BELANJA - ${store}*`,
    `Tanggal: ${formatDate(`${g.date}T00:00:00`, 'short')}`,
    `${g.registeredSupplier ? 'Supplier' : 'Toko'}: ${g.supplierName.trim() || '-'}`,
  ];
  g.notes.map(n => n.trim()).filter(Boolean).forEach(n => lines.push(`Catatan: ${n}`));
  lines.push('');
  let total = 0;
  items.forEach((it, idx) => {
    lines.push(`${idx + 1}. ${it.materialName} - ${qtyLabel(it.qty)} ${it.unit}`.trimEnd());
    const price = it.price ?? 0;
    if (price > 0) {
      const sub = it.qty * price;
      total += sub;
      lines.push(`   @ ${formatRp(price)} = ${formatRp(sub)}`);
    }
  });
  if (total > 0) lines.push('', `*Total: ${formatRp(total)}*`);
  lines.push('', 'Mohon dicek. Terima kasih.');
  if (opts.pdfUrl) lines.push(`Rincian (PDF): ${opts.pdfUrl}`);
  return plainText(lines.join('\n'));
}

// Batas aman panjang teks terenkode pada URL wa.me (di atasnya sebagian peramban/WA memotong atau menolak).
export const SHOPPING_WA_MAX_ENCODED = 4000;
export const shoppingWaFits = (message: string): boolean => encodeURIComponent(message).length <= SHOPPING_WA_MAX_ENCODED;

/** Satu pesan gabungan untuk semua daftar (supplier) pada satu tanggal. */
export function buildShoppingWaDayMessage(date: string, groups: Omit<ShoppingWaGroup, 'date'>[], opts: { storeName?: string; pdfUrl?: string } = {}): string {
  const store = opts.storeName?.trim() || SHOPPING_WA_DEFAULT_STORE;
  const hasPending = (g: Omit<ShoppingWaGroup, 'date'>) => g.items.some(i => i.status === 'pending');
  // Supplier yang semua itemnya selesai dilewati, kecuali SEMUA daftar tanggal itu selesai (kirim semua).
  const anyPending = groups.some(hasPending);
  const included = anyPending ? groups.filter(hasPending) : groups;
  const lines: string[] = [
    `*DAFTAR BELANJA - ${store}*`,
    `Tanggal: ${formatDate(`${date}T00:00:00`, 'short')}`,
  ];
  let grand = 0;
  included.forEach(g => {
    const pend = g.items.filter(i => i.status === 'pending');
    const items = pend.length > 0 ? pend : g.items;
    const name = g.supplierName.trim() || '-';
    lines.push('', g.registeredSupplier ? `*${name}*` : `Toko: *${name}*`);
    g.notes.map(n => n.trim()).filter(Boolean).forEach(n => lines.push(`Catatan: ${n}`));
    let sub = 0;
    items.forEach((it, idx) => {
      lines.push(`${idx + 1}. ${it.materialName} - ${qtyLabel(it.qty)} ${it.unit}`.trimEnd());
      const price = it.price ?? 0;
      if (price > 0) { sub += it.qty * price; lines.push(`   @ ${formatRp(price)} = ${formatRp(it.qty * price)}`); }
    });
    if (sub > 0) lines.push(`   Subtotal: ${formatRp(sub)}`);
    grand += sub;
  });
  if (grand > 0) lines.push('', `*Total semua: ${formatRp(grand)}*`);
  lines.push('', 'Mohon dicek. Terima kasih.');
  if (opts.pdfUrl) lines.push(`Rincian (PDF): ${opts.pdfUrl}`);
  return plainText(lines.join('\n'));
}

/** Nomor WA toko (dari Pengaturan) ada: chat langsung; kosong: wa.me/?text= (pengguna memilih kontak sendiri). */
export function shoppingWaUrl(phone: string | undefined | null, message: string): string {
  const text = encodeURIComponent(message);
  const p = (phone ?? '').trim();
  return p ? `https://wa.me/${normalizePhone(p)}?text=${text}` : `https://wa.me/?text=${text}`;
}
