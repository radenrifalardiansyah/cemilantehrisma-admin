import ExcelJS from 'exceljs';
import { cellText, cellNumber } from '@/lib/excel-cell';

// Excel template/impor/export untuk Purchase Order & Penerimaan Barang (GR). Gaya sama dengan
// Excel Pembelian di MaterialsTab (judul oranye, header oranye, baris contoh abu-abu).

const ORANGE = 'FFE8821A';
const ORANGE_DARK = 'FFC96018';

function download(buffer: ExcelJS.Buffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: ORANGE_DARK } }, bottom: { style: 'thin', color: { argb: ORANGE_DARK } },
      left: { style: 'thin', color: { argb: ORANGE_DARK } }, right: { style: 'thin', color: { argb: ORANGE_DARK } },
    };
  });
}

export async function exportSheet(opts: {
  sheet: string; title: string; filename: string;
  columns: { header: string; width: number }[]; rows: (string | number)[][];
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cemilan Teh Risma Admin';
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.sheet);
  const n = opts.columns.length;
  ws.columns = opts.columns.map(c => ({ width: c.width }));
  ws.mergeCells(1, 1, 1, n);
  const t = ws.getCell(1, 1);
  t.value = opts.title;
  t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE_DARK } };
  ws.getRow(1).height = 26;
  const head = ws.getRow(2);
  opts.columns.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
  styleHeader(head);
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  opts.rows.forEach(r => ws.addRow(r));
  download(await wb.xlsx.writeBuffer(), opts.filename);
}

// ── Template & impor PO ──────────────────────────────────────────────────────
const PO_COLS = [
  { header: 'Tanggal (YYYY-MM-DD)', key: 'date', width: 20 },
  { header: 'Supplier*', key: 'supplierName', width: 24 },
  { header: 'No. WhatsApp Supplier', key: 'supplierPhone', width: 22 },
  { header: 'Estimasi Tiba (YYYY-MM-DD)', key: 'expectedDate', width: 24 },
  { header: 'Bahan Baku*', key: 'materialName', width: 24 },
  { header: 'Qty*', key: 'qty', width: 10 },
  { header: 'Harga Satuan*', key: 'price', width: 16 },
  { header: 'Catatan', key: 'note', width: 28 },
] as const;
type PoKey = typeof PO_COLS[number]['key'];

function detectPoColumn(header: string): PoKey | null {
  const h = header.toLowerCase();
  if (h.includes('estimasi') || h.includes('tiba')) return 'expectedDate';
  if (h.includes('tanggal') || h.includes('date')) return 'date';
  if (h.includes('whatsapp') || h.includes('telepon') || h.includes('phone') || h.includes('hp')) return 'supplierPhone';
  if (h.includes('supplier')) return 'supplierName';
  if (h.includes('bahan')) return 'materialName';
  if (h.includes('qty') || h.includes('jumlah')) return 'qty';
  if (h.includes('harga') || h.includes('price')) return 'price';
  if (h.includes('catatan') || h.includes('note')) return 'note';
  return null;
}

export async function downloadPoTemplate(materialNames: string[], supplierName: string | undefined, today: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cemilan Teh Risma Admin';
  wb.created = new Date();
  const ws = wb.addWorksheet('Template PO');
  const n = PO_COLS.length;
  ws.columns = PO_COLS.map(c => ({ key: c.key, width: c.width }));
  ws.mergeCells(1, 1, 1, n);
  const t = ws.getCell(1, 1);
  t.value = 'TEMPLATE IMPOR PURCHASE ORDER BAHAN BAKU — CEMILAN TEH RISMA';
  t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE_DARK } };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, n);
  const note = ws.getCell(2, 1);
  note.value = 'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. Satu baris = satu bahan baku. '
    + 'Baris dengan Supplier + Tanggal + Estimasi Tiba yang sama digabung menjadi SATU PO (status Draft, belum dikirim). '
    + `Bahan Baku harus persis sama dengan bahan yang sudah ada: ${materialNames.join(', ') || '(belum ada bahan baku)'}.`;
  note.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  note.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  note.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
  ws.getRow(2).height = 56;
  const head = ws.getRow(3);
  PO_COLS.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
  styleHeader(head);
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  const ex = ws.addRow({
    date: today, supplierName: supplierName ?? 'UD Sumber Tani', supplierPhone: '081234567890', expectedDate: '',
    materialName: materialNames[0] ?? 'Tepung Terigu', qty: 50, price: 12000, note: 'Contoh — timpa dengan data Anda',
  });
  ex.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });
  download(await wb.xlsx.writeBuffer(), 'template-purchase-order.xlsx');
}

export interface ParsedPo {
  supplierName: string; supplierPhone: string; date: string; expectedDate: string | null; note: string;
  items: { materialId: string; materialName: string; unit: string; qty: number; price: number }[];
}

// Baca Excel PO → daftar PO (digabung per supplier+tanggal+estimasi). `skipped` = baris tidak valid.
export async function parsePoExcel(
  file: File, materials: { id: string; name: string; unit: string }[], today: string,
): Promise<{ pos: ParsedPo[]; skipped: number } | { error: string }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { error: 'File Excel tidak valid.' };

  let headerRowNum = -1;
  let colField = new Map<number, PoKey>();
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const map = new Map<number, PoKey>();
    ws.getRow(r).eachCell((cell, colNumber) => {
      const f = detectPoColumn(cell.value?.toString() ?? '');
      if (f) map.set(colNumber, f);
    });
    if (new Set(map.values()).has('materialName')) { headerRowNum = r; colField = map; break; }
  }
  if (headerRowNum === -1) return { error: 'Kolom "Bahan Baku" tidak ditemukan. Gunakan template yang disediakan.' };

  const matByName = new Map(materials.map(m => [m.name.trim().toLowerCase(), m]));
  const groups = new Map<string, ParsedPo>();
  let skipped = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNum) return;
    const raw = Object.fromEntries(PO_COLS.map(c => [c.key, ''])) as Record<PoKey, string>;
    const vals: Partial<Record<PoKey, unknown>> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const f = colField.get(colNumber);
      if (!f) return;
      raw[f] = cellText(cell.value);
      vals[f] = cell.value;
    });
    if (!raw.materialName.trim()) return;
    const m = matByName.get(raw.materialName.trim().toLowerCase());
    const qty = cellNumber(vals.qty) || 0;
    const price = cellNumber(vals.price) || 0;
    const supplier = raw.supplierName.trim();
    if (!m || !supplier || qty <= 0 || price < 0) { skipped++; return; }
    const date = raw.date.trim() || today;
    const expected = raw.expectedDate.trim();
    const key = `${supplier.toLowerCase()}|${date}|${expected}`;
    const g = groups.get(key) ?? { supplierName: supplier, supplierPhone: raw.supplierPhone.trim(), date, expectedDate: expected || null, note: raw.note.trim(), items: [] };
    g.items.push({ materialId: m.id, materialName: m.name, unit: m.unit, qty, price });
    groups.set(key, g);
  });
  return { pos: [...groups.values()], skipped };
}
