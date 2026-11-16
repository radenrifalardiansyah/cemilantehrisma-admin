import ExcelJS from 'exceljs';

// Unduh laporan Piutang Mitra sebagai .xlsx (gaya sama dengan export Riwayat Pembayaran Hutang Supplier):
// judul, subjudul, header oranye, baris data, lalu baris total. `moneyCols` = nomor kolom (1-based) berformat Rupiah.
export async function downloadMitraExcel(o: {
  sheet: string; title: string; subtitle: string; headers: readonly string[];
  body: (string | number)[][]; total: (string | number)[]; moneyCols: number[]; filePrefix: string;
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cemilan Teh Risma Admin';
  wb.created = new Date();
  const ws = wb.addWorksheet(o.sheet);
  const colCount = o.headers.length;
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  ws.mergeCells(1, 1, 1, colCount);
  const title = ws.getCell(1, 1);
  title.value = o.title;
  title.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = fill('FFC96018');
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, colCount);
  const sub = ws.getCell(2, 1);
  sub.value = o.subtitle;
  sub.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  sub.alignment = { horizontal: 'center', vertical: 'middle' };
  sub.fill = fill('FFFDF2E9');
  const HEADER = 3;
  const hr = ws.getRow(HEADER);
  o.headers.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  hr.height = 24;
  hr.eachCell(c => {
    c.fill = fill('FFE8821A');
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  ws.views = [{ state: 'frozen', ySplit: HEADER }];
  const styleMoney = (row: ExcelJS.Row) => o.moneyCols.forEach(c => {
    row.getCell(c).numFmt = '"Rp"#,##0';
    row.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
  });
  o.body.forEach(r => {
    const row = ws.addRow(r);
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    styleMoney(row);
  });
  const tr = ws.addRow(o.total);
  tr.font = { bold: true };
  styleMoney(tr);
  tr.eachCell({ includeEmpty: true }, c => { c.fill = fill('FFFDF2E9'); });
  ws.columns.forEach(column => {
    let max = 8;
    for (let r = HEADER; r <= ws.rowCount; r++) { const v = ws.getRow(r).getCell(column.number!).value; const len = v == null ? 0 : v.toString().length; if (len > max) max = len; }
    column.width = Math.min(max + 2, 50);
  });
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${o.filePrefix}-cemilantehrisma-${new Date().toLocaleDateString('en-CA')}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
