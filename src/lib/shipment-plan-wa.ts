import { SHOPPING_WA_DEFAULT_STORE, plainText } from './shopping-wa';

// Pesan WA "Rencana Kirim Stok" ke nomor WA toko sendiri: gabungan semua draf kirim stok terpilih, per mitra
// (item + pcs, TANPA harga) plus total per produk dan total keseluruhan — untuk tahu berapa pcs yang harus dibuat
// dan dikirim ke mitra mana. Murni (tanpa DB/HTTP) supaya aman di klien dan bisa diuji. ASCII murni dan tanpa blok monospace
// (alasan sama dengan shopping-wa.ts).

export interface ShipmentPlanDraft {
  locationId?: string;
  locationName: string;
  items: { productId: string; productName: string; qty: number }[];
  note?: string;
}

const qtyLabel = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

export function buildShipmentPlanWaMessage(drafts: ShipmentPlanDraft[], opts: { storeName?: string } = {}): string {
  const store = opts.storeName?.trim() || SHOPPING_WA_DEFAULT_STORE;

  // Beberapa draf untuk mitra yang sama digabung jadi satu bagian.
  const byMitra = new Map<string, { name: string; items: Map<string, { name: string; qty: number }>; notes: string[] }>();
  for (const d of drafts) {
    const key = d.locationId || `n:${d.locationName.trim().toLowerCase()}`;
    const m = byMitra.get(key) ?? { name: d.locationName.trim() || '-', items: new Map<string, { name: string; qty: number }>(), notes: [] as string[] };
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
  const mitras = [...byMitra.values()].filter(m => m.items.size > 0);

  const lines: string[] = [`*RENCANA KIRIM STOK - ${store}*`, `Jumlah mitra: ${mitras.length}`];
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
