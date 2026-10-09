import ExcelJS from 'exceljs';
import { cellText } from '@/lib/excel-cell';

export interface ImportCol {
  header: string;       // judul kolom di template
  key: string;          // nama field yang dikirim ke server
  width: number;
  aliases: string[];    // judul kolom yang dikenali (sudah dinormalkan: huruf kecil, tanpa simbol/spasi)
  required?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const edge = (argb: string) => ({ style: 'thin' as const, color: { argb } });

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Template Excel dengan gaya yang sama seperti template Supplier: judul oranye, petunjuk, header, baris contoh.
export async function downloadTemplate(opts: {
  sheet: string; title: string; note: string; file: string; cols: ImportCol[]; example: Record<string, string>;
  textKeys?: string[];
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cemilan Teh Risma Admin';
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.sheet);
  const n = opts.cols.length;
  ws.columns = opts.cols.map(c => ({ key: c.key, width: c.width }));

  ws.mergeCells(1, 1, 1, n);
  const t = ws.getCell(1, 1);
  t.value = opts.title;
  t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, n);
  const note = ws.getCell(2, 1);
  note.value = opts.note;
  note.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  note.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  note.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
  ws.getRow(2).height = 48;

  const HEADER = 3;
  const hr = ws.getRow(HEADER);
  opts.cols.forEach((c, i) => { hr.getCell(i + 1).value = c.header; });
  hr.height = 24;
  hr.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { top: edge('FFC96018'), bottom: edge('FFC96018'), left: edge('FFC96018'), right: edge('FFC96018') };
  });
  ws.views = [{ state: 'frozen', ySplit: HEADER }];
  for (const k of opts.textKeys ?? []) ws.getColumn(k).numFmt = '@';

  const ex = ws.addRow(opts.example);
  ex.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

  const buffer = await wb.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), opts.file);
}

// Baca file Excel → daftar baris { key: teks }. Baris judul dicari di 10 baris pertama (yang memuat
// semua kolom wajib); baris contoh dari template (teks "Contoh") ikut dilewati.
export async function readRows(file: File, cols: ImportCol[]): Promise<{ rows: Record<string, string>[] } | { error: string }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { error: 'File Excel tidak valid.' };

  const required = cols.filter(c => c.required).map(c => c.key);
  let headerRow = -1;
  let colField = new Map<number, string>();
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const map = new Map<number, string>();
    const used = new Set<string>();
    const cells: [number, string][] = [];
    ws.getRow(r).eachCell((cell, colNumber) => cells.push([colNumber, norm(cellText(cell.value))]));
    // Cocok persis dulu, baru awalan — supaya "Nama" tidak merebut kolom "Nama Produk".
    for (const exact of [true, false]) {
      for (const [colNumber, h] of cells) {
        if (!h || map.has(colNumber)) continue;
        const col = cols.find(c => !used.has(c.key) && c.aliases.some(a => exact ? h === a : h.startsWith(a)));
        if (col) { map.set(colNumber, col.key); used.add(col.key); }
      }
    }
    if (required.every(k => used.has(k))) { headerRow = r; colField = map; break; }
  }
  if (headerRow === -1) {
    const names = cols.filter(c => c.required).map(c => `"${c.header.replace('*', '')}"`).join(', ');
    return { error: `Kolom ${names} tidak ditemukan. Gunakan template yang disediakan.` };
  }

  const rows: Record<string, string>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const raw: Record<string, string> = Object.fromEntries(cols.map(c => [c.key, '']));
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const field = colField.get(colNumber);
      if (field) raw[field] = cellText(cell.value);
    });
    if (required.every(k => raw[k].trim()) || cols.some(c => raw[c.key].trim())) {
      if (!/^contoh/i.test(raw[cols[cols.length - 1].key] ?? '')) rows.push(raw);
    }
  });
  return { rows };
}
