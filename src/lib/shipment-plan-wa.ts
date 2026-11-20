import { SHOPPING_WA_DEFAULT_STORE, plainText } from './shopping-wa';
import { formatDate } from './format';

// Pesan WA "Rencana Kirim Stok" ke nomor WA toko sendiri: gabungan semua draf kirim stok terpilih, per mitra
// (item + pcs, TANPA harga) plus total per produk dan total keseluruhan — untuk tahu berapa pcs yang harus dibuat
// dan dikirim ke mitra mana. Murni (tanpa DB/HTTP) supaya aman di klien dan bisa diuji. ASCII murni dan tanpa blok monospace
// (alasan sama dengan shopping-wa.ts).

export interface ShipmentPlanDraft {
  locationId?: string;
  locationName: string;
  items: { productId: string; productName: string; qty: number }[];
  note?: string;
  /** Nomor urutan pengiriman (kecil = lebih dulu); kosong = di bawah yang bernomor. */
  deliverySeq?: number | null;
  /** Tanggal kirim (tanggal dokumen pengiriman): Date/ISO/epoch ms; kosong = tidak ditampilkan. */
  date?: Date | string | number | null;
}

const WIB_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Kunci hari WIB (yyyy-mm-dd), null bila tanggal kosong/tidak valid. */
const wibDay = (d: ShipmentPlanDraft['date']): string | null => {
  if (d === null || d === undefined || d === '') return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : WIB_DAY.format(t);
};
const WEEKDAY = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' });
/** Contoh: "Sabtu, 21 Nov 2026". */
const dayLabel = (key: string) => {
  const noon = new Date(`${key}T12:00:00+07:00`);
  return `${WEEKDAY.format(noon)}, ${formatDate(noon, 'short', 'Asia/Jakarta')}`;
};

const qtyLabel = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

export function buildShipmentPlanWaMessage(drafts: ShipmentPlanDraft[], opts: { storeName?: string } = {}): string {
  const store = opts.storeName?.trim() || SHOPPING_WA_DEFAULT_STORE;

  // Beberapa draf untuk mitra yang sama digabung jadi satu bagian.
  const byMitra = new Map<string, { name: string; seq: number | null; order: number; items: Map<string, { name: string; qty: number }>; notes: string[] }>();
  for (const d of drafts) {
    const key = d.locationId || `n:${d.locationName.trim().toLowerCase()}`;
    const m = byMitra.get(key) ?? { name: d.locationName.trim() || '-', seq: null as number | null, order: byMitra.size, items: new Map<string, { name: string; qty: number }>(), notes: [] as string[] };
    // Beberapa draf mitra yang sama: pakai nomor terkecil.
    if (typeof d.deliverySeq === 'number' && (m.seq === null || d.deliverySeq < m.seq)) m.seq = d.deliverySeq;
    for (const it of d.items) {
      if (!(it.qty > 0)) continue;
      const k = it.productId || `n:${it.productName.trim().toLowerCase()}`;
      const cur = m.items.get(k) ?? { name: it.productName.trim(), qty: 0 };
      cur.qty += it.qty;
      m.items.set(k, cur);
    }
    const note = d.note?.trim();
    if (note && !m.notes.includes(note)) m.notes.push(note);
    byMitra.set(key, m);
  }
  // Urut sesuai urutan pengiriman; yang belum bernomor di bawah, mengikuti urutan input (sort stabil lewat `order`).
  const mitras = [...byMitra.values()].filter(m => m.items.size > 0)
    .sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || a.order - b.order);

  // Tanggal kirim: satu tanggal bila semua sama; beda-beda tampil sebagai rentang (terawal s/d terakhir).
  const days = [...new Set(drafts.map(d => wibDay(d.date)).filter((k): k is string => k !== null))].sort();
  const dateText = days.length === 0 ? null : days.length === 1 ? dayLabel(days[0]) : `${dayLabel(days[0])} s/d ${dayLabel(days[days.length - 1])}`;
  const lines: string[] = [`*RENCANA KIRIM STOK - ${store}*`];
  if (dateText) lines.push(`Tanggal kirim: ${dateText}`);
  lines.push(`Jumlah mitra: ${mitras.length}`);
  if (mitras.some(m => m.seq !== null)) lines.push('Urutan sesuai urutan pengiriman');
  const perProduct = new Map<string, { name: string; qty: number }>();
  let grand = 0;
  mitras.forEach((m, i) => {
    lines.push('', `${i + 1}. *${m.name}*`);
    let sub = 0;
    for (const [k, it] of m.items) {
      lines.push(`   - ${it.name}: ${qtyLabel(it.qty)} pcs`);
      sub += it.qty;
      const p = perProduct.get(k) ?? { name: it.name, qty: 0 };
      p.qty += it.qty;
      perProduct.set(k, p);
    }
    m.notes.forEach(n => lines.push(`   Catatan: ${n}`));
    lines.push(`   Subtotal: ${qtyLabel(sub)} pcs`);
    grand += sub;
  });

  lines.push('', '*TOTAL PER PRODUK*');
  [...perProduct.values()].sort((a, b) => a.name.localeCompare(b.name, 'id')).forEach(p => lines.push(`- ${p.name}: ${qtyLabel(p.qty)} pcs`));
  lines.push('', `*Total semua: ${qtyLabel(grand)} pcs*`);
  return plainText(lines.join('\n'));
}
