import { pdf } from '@react-pdf/renderer';
import FinanceReportPDF from '@/lib/pdf/FinanceReportPDF';

export async function GET() {
  const journal = Array.from({ length: 25 }, (_, i) => {
    const debit = i % 3 === 0 ? 0 : 50000 + i * 1234;
    const kredit = i % 3 === 0 ? 20000 + i * 500 : 0;
    return {
      tanggal: `${(i % 28) + 1} Sep 2026`,
      jam: `${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
      keterangan: i % 3 === 0 ? `Sewa - Bulan ${i}` : `Penjualan Kasir - INV-000${i}`,
      debit, kredit,
      saldo: 1000000 + i * 3000,
    };
  });

  const blob = await pdf(
    <FinanceReportPDF
      store={{ name: 'Cemilan Teh Risma', tagline: 'Camilan Rumahan Sejak 2020', address: 'Jl. Contoh No. 1, Jakarta', phone: '0812xxxxxxx' }}
      data={{
        periodLabel: 'Bulan Ini',
        from: '2026-09-01',
        to: '2026-09-30',
        incomeRows: [
          { label: 'Penjualan Kasir', amount: 5_200_000 },
          { label: 'Penjualan Online', amount: 3_100_000 },
          { label: 'Pendapatan Konsinyasi', amount: 1_800_000 },
          { label: 'Pendapatan Lain-lain', amount: 250_000 },
        ],
        totalPendapatan: 10_350_000,
        hpp: 4_100_000,
        labaKotor: 6_250_000,
        expenseRows: [
          { category: 'Sewa', amount: 1_000_000, foldedIntoHpp: false },
          { category: 'Gaji', amount: 1_500_000, foldedIntoHpp: false },
          { category: 'Bahan Baku', amount: 2_000_000, foldedIntoHpp: true },
          { category: 'Listrik & Air', amount: 300_000, foldedIntoHpp: false },
        ],
        totalBeban: 4_800_000,
        totalBebanOperasional: 2_800_000,
        labaBersih: 3_450_000,
        totalModalMasuk: 500_000,
        totalPrive: 200_000,
        saldoAwal: 1_000_000,
        journal,
      }}
    />
  ).toBuffer();

  const chunks: Buffer[] = [];
  for await (const chunk of blob as unknown as AsyncIterable<Buffer>) chunks.push(chunk as Buffer);
  const buf = Buffer.concat(chunks);

  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf' } });
}
