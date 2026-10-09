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
Status: ${s.status === 'paid' ? 'SUDAH DIBAYAR' : 'Belum dibayar'}
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
