import ExcelJS from 'exceljs';
import { cellText, parseIdNumber } from '@/lib/excel-cell';

// Template & pembaca Excel untuk Import Kirim Stok / Rekap Harian (Mitra). Satu baris = satu
// produk; baris dengan Lokasi/Tanggal/dst yang sama digabung jadi satu pengiriman/rekap.

export interface ImportCol { header: string; key: string; width: number; example: string }

export const SHIPMENT_IMPORT_COLS: ImportCol[] = [
  { header: 'Lokasi*',      key: 'location',   width: 24, example: 'Warung Bu Yanti' },
  { header: 'Gudang*',      key: 'warehouse',  width: 18, example: 'Gudang Utama' },
  { header: 'Tanggal',      key: 'date',       width: 14, example: '2026-10-01' },
  { header: 'Produk*',      key: 'product',    width: 28, example: 'Keripik Kimpul' },
  { header: 'Qty*',         key: 'qty',        width: 10, example: '20' },
  { header: 'Harga Titip*', key: 'hargaTitip', width: 14, example: '12000' },
  { header: 'Catatan',      key: 'note',       width: 26, example: '' },
];

export const RECAP_IMPORT_COLS: ImportCol[] = [
  { header: 'Lokasi*',      key: 'location',   width: 24, example: 'Warung Bu Yanti' },
  { header: 'Tanggal',      key: 'date',       width: 14, example: '2026-10-01' },
  { header: 'Produk*',      key: 'product',    width: 28, example: 'Keripik Kimpul' },
  { header: 'Terjual',      key: 'sold',       width: 10, example: '15' },
  { header: 'Retur',        key: 'retur',      width: 10, example: '2' },
  { header: 'Reject',       key: 'reject',     width: 10, example: '0' },
  { header: 'Status Bayar', key: 'payment',    width: 14, example: 'Lunas' },
  { header: 'Dompet',       key: 'wallet',     width: 18, example: 'Kas Tunai' },
  { header: 'Gudang',       key: 'warehouse',  width: 18, example: 'Gudang Utama' },
  { header: 'Catatan',      key: 'note',       width: 26, example: '' },
];

const normHeader = (s: string) => s.replace(/\*/g, '').trim().toLowerCase();
export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const BORDER = { style: 'thin' as const, color: { argb: 'FFC96018' } };

function download(buffer: ExcelJS.Buffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadImportTemplate(opts: { title: string; sheetName: string; note: string; cols: ImportCol[]; filename: string }) {
  const { title, sheetName, note, cols, filename } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cemilan Teh Risma Admin';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = cols.map(c => ({ key: c.key, width: c.width }));

  ws.mergeCells(1, 1, 1, cols.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, cols.length);
  const noteCell = ws.getCell(2, 1);
  noteCell.value = note;
  noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
  ws.getRow(2).height = 58;

  const headerRow = ws.getRow(3);
  cols.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
  headerRow.height = 24;
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
  });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  ws.getColumn('date').numFmt = '@';

  const example = ws.addRow(Object.fromEntries(cols.map(c => [c.key, c.example])));
  example.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

  download(await wb.xlsx.writeBuffer(), filename);
}

export interface ImportRow { rowNumber: number; values: Record<string, string> }

// Baca baris data. Header dicari di 10 baris pertama (cocok persis dengan judul kolom template,
// tanpa tanda bintang & tak peduli huruf besar/kecil). Melempar Error kalau header tidak ketemu.
export async function readImportRows(file: File, cols: ImportCol[]): Promise<ImportRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('File Excel tidak valid.');

  let headerRowNum = -1;
  let colKey = new Map<number, string>();
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const map = new Map<number, string>();
    ws.getRow(r).eachCell((cell, colNumber) => {
      const h = normHeader(cellText(cell.value));
      const col = cols.find(c => normHeader(c.header) === h);
      if (col) map.set(colNumber, col.key);
    });
    if (map.size >= 2) { headerRowNum = r; colKey = map; break; }
  }
  if (headerRowNum === -1) throw new Error('Judul kolom tidak ditemukan. Gunakan template yang disediakan.');

  const rows: ImportRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNum) return;
    const values: Record<string, string> = Object.fromEntries(cols.map(c => [c.key, '']));
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = colKey.get(colNumber);
      if (key) values[key] = cellText(cell.value);
    });
    if (Object.values(values).every(v => !v)) return;
    rows.push({ rowNumber, values });
  });
  return rows;
}

// "2026-10-01" atau "01/10/2026" → ISO datetime (jam 12:00 lokal supaya tidak geser hari). Kosong → sekarang.
// Mengembalikan null kalau isinya ada tapi bukan tanggal valid.
export function importDateToISO(raw: string): string | null {
  const t = raw.trim();
  if (!t) return new Date().toISOString();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else return null;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  if (isNaN(date.getTime()) || date.getMonth() !== m - 1) return null;
  return date.toISOString();
}

// Angka kosong → 0; teks bukan angka → NaN.
export function importNumber(raw: string): number {
  return raw.trim() ? parseIdNumber(raw) : 0;
}
