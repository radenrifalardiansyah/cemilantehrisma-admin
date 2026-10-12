import { pdf } from '@react-pdf/renderer';
import SettlementNotePDF from '@/lib/pdf/SettlementNotePDF';
import type { StoreHeader } from '@/lib/pdf/ShipmentNotePDF';
import { toDataUri } from '@/lib/pdf/logo';
import { qtyText } from './shared';

export interface SettlementItem { productId: string; productName: string; qty: number; amount: number }
export interface Settlement {
  id: string; docNumber: string; stallId: string; stallName: string; consignorId: string; consignorName: string;
  periodFrom: string; periodTo: string; totalAmount: number; linesCount: number; items: SettlementItem[]; status: 'unpaid' | 'paid';
  note: string; createdBy: string; createdAt: { seconds: number } | null; paidAt: { seconds: number } | null; paidBy: string;
  payDate?: string; payMethod?: 'transfer' | 'tunai' | ''; payFrom?: string; payReference?: string; payNote?: string; payProofUrl?: string;
}
// Data penitip untuk blok "Penerima" di nota (opsional — kasir lapak tidak punya akses data penitip).
export interface SettlementConsignor { name: string; phone?: string; address?: string; bankName?: string; bankAccount?: string; bankHolder?: string }

const dateText = (key: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : key;
};
const tsDate = (t: { seconds: number } | null) => t ? new Date(t.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

// Nota rekap bagi hasil per penitip (A4 portrait, dokumen resmi): Nota Rekap bila belum dibayar, Bukti Pembayaran
// bila sudah — dipakai admin (Rekap & Bayar) dan kasir lapak (laporan ke owner).
export async function downloadSettlementPdf(s: Settlement, store: StoreHeader, consignor?: SettlementConsignor): Promise<void> {
  const paid = s.status === 'paid';
  const proofImage = paid && s.payProofUrl ? await toDataUri(s.payProofUrl) : undefined;
  const blob = await pdf(
    <SettlementNotePDF store={store} data={{
      docNumber: s.docNumber, status: s.status, createdAtText: tsDate(s.createdAt) || '-',
      periodText: s.periodFrom === s.periodTo ? dateText(s.periodFrom) : `${dateText(s.periodFrom)} s/d ${dateText(s.periodTo)}`,
      stallName: s.stallName, consignor: consignor ?? { name: s.consignorName },
      items: s.items.map(i => ({ name: i.productName, qty: qtyText(i.qty), amount: i.amount })),
      totalQty: qtyText(s.items.reduce((a, i) => a + i.qty, 0)), total: s.totalAmount, note: s.note || undefined, createdBy: s.createdBy || undefined,
      printedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      paid: paid ? {
        dateText: s.payDate ? dateText(s.payDate) : tsDate(s.paidAt),
        method: s.payMethod === 'tunai' ? 'Tunai' : 'Transfer', from: s.payFrom || undefined, reference: s.payReference || undefined,
        note: s.payNote || undefined, paidBy: s.paidBy || undefined, proofImage,
      } : undefined,
    }} />,
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${paid ? 'bukti-bayar' : 'nota-rekap'}-${s.docNumber}.pdf`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
