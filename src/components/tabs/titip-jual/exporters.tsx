import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import type { StoreHeader } from '@/lib/pdf/ShipmentNotePDF';

export interface ExportCol<T> {
  header: string;
  width: string;                       // lebar kolom PDF dalam persen, mis. '12%'
  align?: 'left' | 'right' | 'center';
  bold?: boolean;
  value: (row: T) => string | number;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const today = () => new Date().toLocaleDateString('en-CA');

// Excel dengan gaya yang sama seperti export Supplier/Mitra: judul oranye, header, zebra, filter.
export async function exportExcel<T>(cols: ExportCol<T>[], rows: T[], title: string, label: string, file: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cemilan Teh Risma Admin';
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 30));
  const colCount = cols.length + 1;
  ws.columns = [{ key: 'no', width: 6 }, ...cols.map((_, i) => ({ key: `c${i}`, width: 16 }))];

  ws.mergeCells(1, 1, 1, colCount);
  const t = ws.getCell(1, 1);
  t.value = `${title} — CEMILAN TEH RISMA`;
  t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, colCount);
  const sub = ws.getCell(2, 1);
  sub.value = `${rows.length} data (${label}) · Diexport ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  sub.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  sub.alignment = { horizontal: 'center', vertical: 'middle' };
  sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
  ws.getRow(2).height = 20;

  const HEADER = 3;
  const hr = ws.getRow(HEADER);
  hr.getCell(1).value = 'No';
  cols.forEach((c, i) => { hr.getCell(i + 2).value = c.header; });
  hr.height = 24;
  const edge = (argb: string) => ({ style: 'thin' as const, color: { argb } });
  hr.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { top: edge('FFC96018'), bottom: edge('FFC96018'), left: edge('FFC96018'), right: edge('FFC96018') };
  });
  ws.views = [{ state: 'frozen', ySplit: HEADER }];

  rows.forEach((r, i) => {
    const row = ws.addRow([i + 1, ...cols.map(c => c.value(r))]);
    const zebra = i % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF';
    row.eachCell((cell, n) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      cell.border = { top: edge('FFE5E7EB'), bottom: edge('FFE5E7EB'), left: edge('FFE5E7EB'), right: edge('FFE5E7EB') };
      const a = n === 1 ? 'center' : cols[n - 2].align ?? 'left';
      cell.alignment = { vertical: 'middle', horizontal: a, wrapText: false };
    });
  });

  ws.autoFilter = { from: `A${HEADER}`, to: `${ws.getColumn(colCount).letter}${HEADER}` };
  ws.columns.forEach(column => {
    let maxLen = 8;
    for (let r = HEADER; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).getCell(column.number!).value;
      const len = v == null ? 0 : v.toString().length;
      if (len > maxLen) maxLen = len;
    }
    column.width = Math.min(maxLen + 2, 50);
  });

  const buffer = await wb.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${file}-cemilantehrisma-${today()}.xlsx`);
}

export async function exportPdf<T>(cols: ExportCol<T>[], rows: T[], title: string, label: string, file: string, store: StoreHeader) {
  const noWidth = 5;
  const total = cols.reduce((a, c) => a + parseFloat(c.width), 0);
  const scale = (100 - noWidth) / total;
  const blob = await pdf(
    <GenericTablePDF
      store={store}
      data={{
        title, label,
        generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        columns: [
          { header: 'No', width: `${noWidth}%`, align: 'center' },
          ...cols.map(c => ({ header: c.header, width: `${(parseFloat(c.width) * scale).toFixed(2)}%`, align: c.align, bold: c.bold })),
        ],
        rows: rows.map((r, i) => [i + 1, ...cols.map(c => c.value(r))]),
      }}
    />,
  ).toBlob();
  download(blob, `${file}-cemilantehrisma-${today()}.pdf`);
}
