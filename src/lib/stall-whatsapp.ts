// Pesan & tautan WhatsApp untuk Titip Jual / Kasir Lapak. Memakai tautan wa.me (tanpa layanan berbayar):
// pengguna tinggal menekan kirim di WhatsApp. Tidak ada kirim otomatis.

// Nomor Indonesia → format internasional tanpa '+' ("0812-3456-7890" → "6281234567890"). null = tidak valid.
export function normalizeWaPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

// Tanpa nomor valid, tautan tetap dibuat (WhatsApp meminta memilih kontak).
export function waLink(phone: string | null | undefined, text: string): string {
  const n = normalizeWaPhone(phone);
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(text)}`;
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
const qty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 3 });
const SEP = '───────────────';

export interface WaSettlement {
  docNumber: string; consignorName: string; stallName: string; periodFrom: string; periodTo: string;
  totalAmount: number; status: 'unpaid' | 'paid'; items: { productName: string; qty: number; amount: number }[];
  payDate?: string; payMethod?: string; payReference?: string; payFrom?: string; payProofUrl?: string;
}

// Baris rincian pembayaran (hanya bila sudah dibayar): tanggal, metode, dan no. referensi.
function payInfo(s: WaSettlement): string {
  if (s.status !== 'paid') return '';
  const method = s.payMethod === 'tunai' ? 'Tunai' : s.payMethod === 'transfer' ? 'Transfer' : '';
  return [
    s.payDate ? `\nDibayar: ${s.payDate}` : '',
    method ? `\nMetode: ${method}` : '',
    s.payReference ? `\nNo. referensi: ${s.payReference}` : '',
    s.payProofUrl ? `\nBukti transfer: ${s.payProofUrl}` : '',
  ].join('');
}

// Rekap bagi hasil: ke penitip (admin) atau ke owner (kasir lapak).
export function settlementMessage(s: WaSettlement, storeName: string, audience: 'penitip' | 'owner'): string {
  const lines = s.items.map((i, idx) => `${idx + 1}. ${i.productName} ×${qty(i.qty)} — ${rp(i.amount)}`).join('\n');
  const head = audience === 'penitip'
    ? `Halo ${s.consignorName}, berikut rekap penjualan titipan Anda di ${storeName}:`
    : `Laporan rekap titipan dari ${s.stallName} untuk ${s.consignorName}:`;
  return `*REKAP BAGI HASIL TITIP JUAL*
${head}

No: ${s.docNumber}
Lapak: ${s.stallName}
Periode: ${s.periodFrom === s.periodTo ? s.periodFrom : `${s.periodFrom} s/d ${s.periodTo}`}
Status: ${s.status === 'paid' ? 'SUDAH DIBAYAR' : 'Belum dibayar'}${payInfo(s)}
${SEP}
${lines}
${SEP}
*TOTAL ${audience === 'penitip' ? 'BAGIAN ANDA' : 'UNTUK PENITIP'}: ${rp(s.totalAmount)}*

Terima kasih.
_${storeName}_`;
}

export interface WaSale {
  invoiceNo: string; stallName: string; date: string; cashier: string; subtotal: number; discount: number; total: number;
  paymentMethod: 'cash' | 'qris' | 'transfer'; amountPaid: number; changeAmount: number;
  items: { name: string; qty: number; price: number; subtotal: number }[];
}
const PAY: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' };

// Struk penjualan lapak untuk pelanggan.
export function receiptMessage(s: WaSale, storeName: string, customerName?: string): string {
  const lines = s.items.map((i, idx) => `${idx + 1}. ${i.name}\n   ${qty(i.qty)} × ${rp(i.price)} = ${rp(i.subtotal)}`).join('\n');
  return `*STRUK ${storeName.toUpperCase()}*
${s.stallName}
${SEP}
No: ${s.invoiceNo}
${s.date} · Kasir: ${s.cashier}${customerName ? `\nPelanggan: ${customerName}` : ''}
${SEP}
${lines}
${SEP}
Subtotal: ${rp(s.subtotal)}${s.discount > 0 ? `\nDiskon: -${rp(s.discount)}` : ''}
*TOTAL: ${rp(s.total)}*
${PAY[s.paymentMethod] ?? s.paymentMethod}: ${rp(s.amountPaid)}${s.paymentMethod === 'cash' ? `\nKembali: ${rp(s.changeAmount)}` : ''}

Terima kasih telah berbelanja! 🙏`;
}

export interface StockUpdateData {
  stallName: string; generatedAtText: string; lastUpdateText: string | null;
  consignors: { name: string; products: { name: string; unit: string; stock: number; sold: number; received: number }[] }[];
}

// Update stok titipan untuk grup WhatsApp penitip: per penitip daftar produk + stok saat ini. Bila ada update
// sebelumnya, tiap produk juga menampilkan terjual & masuk sejak saat itu. `includeEmpty` = ikutkan produk stok 0.
export function stockUpdateMessage(d: StockUpdateData, includeEmpty: boolean): string {
  const sections: string[] = [];
  let productCount = 0; let totalQty = 0;
  for (const c of d.consignors) {
    const list = c.products.filter(p => includeEmpty || p.stock > 0 || p.sold > 0);
    if (list.length === 0) continue;
    const rows = list.map((p, i) => {
      const extra = [p.sold > 0 ? `terjual ${qty(p.sold)}` : '', p.received > 0 ? `masuk ${qty(p.received)}` : ''].filter(Boolean).join(', ');
      productCount++; totalQty += p.stock;
      return `${i + 1}. ${p.name} — stok *${qty(p.stock)}*${p.stock <= 0 ? ' (habis)' : ''}${extra ? ` _(${extra})_` : ''}`;
    });
    sections.push(`*${c.name}*\n${rows.join('\n')}`);
  }
  const since = d.lastUpdateText ? `Sejak update terakhir: ${d.lastUpdateText}` : 'Update pertama (belum ada pembanding)';
  return `*UPDATE STOK TITIPAN*
Lapak: ${d.stallName}
Per: ${d.generatedAtText}
${since}

${sections.length > 0 ? sections.join(`\n\n${SEP}\n`) : '(tidak ada produk titipan)'}

Total: ${productCount} produk, ${qty(totalQty)} stok saat ini.`;
}
