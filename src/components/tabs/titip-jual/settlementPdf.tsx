import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import type { StoreHeader } from '@/lib/pdf/ShipmentNotePDF';
import { rupiah, qtyText } from './shared';

export interface SettlementItem { productId: string; productName: string; qty: number; amount: number }
export interface Settlement {
  id: string; docNumber: string; stallId: string; stallName: string; consignorId: string; consignorName: string;
  periodFrom: string; periodTo: string; totalAmount: number; linesCount: number; items: SettlementItem[]; status: 'unpaid' | 'paid';
  note: string; createdBy: string; createdAt: { seconds: number } | null; paidAt: { seconds: number } | null; paidBy: string;
}

// PDF rekap bagi hasil per penitip — dipakai admin (Rekap & Bayar) dan kasir lapak (laporan ke owner).
export async function downloadSettlementPdf(s: Settlement, store: StoreHeader): Promise<void> {
  const blob = await pdf(
    <GenericTablePDF store={store} data={{
      title: 'REKAP BAGI HASIL TITIP JUAL',
      label: `${s.docNumber} · ${s.consignorName} · ${s.stallName} · ${s.periodFrom} s/d ${s.periodTo} · ${s.status === 'paid' ? 'SUDAH DIBAYAR' : 'BELUM DIBAYAR'}`,
      generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      columns: [
        { header: 'No', width: '8%', align: 'center' }, { header: 'Produk', width: '52%', bold: true },
        { header: 'Terjual', width: '15%', align: 'right' }, { header: 'Bagian Penitip', width: '25%', align: 'right' },
      ],
      rows: [
        ...s.items.map((i, idx) => [idx + 1, i.productName, qtyText(i.qty), rupiah(i.amount)]),
        ['', 'TOTAL', qtyText(s.items.reduce((a, i) => a + i.qty, 0)), rupiah(s.totalAmount)],
      ],
    }} />,
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `rekap-${s.docNumber}.pdf`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
