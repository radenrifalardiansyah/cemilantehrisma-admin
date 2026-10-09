import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readRows, type ImportCol } from './importers';

const COLS: ImportCol[] = [
  { header: 'Penitip*', key: 'consignor', width: 20, aliases: ['penitip', 'namapenitip'], required: true },
  { header: 'Nama Produk*', key: 'name', width: 20, aliases: ['namaproduk', 'produk', 'nama'], required: true },
  { header: 'Harga Jual*', key: 'price', width: 12, aliases: ['hargajual', 'harga'], required: true },
  { header: 'Catatan', key: 'note', width: 20, aliases: ['catatan'] },
];

async function fileOf(build: (ws: ExcelJS.Worksheet) => void): Promise<File> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet('S'));
  const buf = await wb.xlsx.writeBuffer();
  return new File([buf], 'x.xlsx');
}

describe('readRows', () => {
  it('menemukan baris judul di baris 3, memetakan "Nama Produk*" ke name, dan melewati baris contoh', async () => {
    const f = await fileOf(ws => {
      ws.addRow(['JUDUL']); ws.addRow(['petunjuk']);
      ws.addRow(['Penitip*', 'Nama Produk*', 'Harga Jual*', 'Catatan']);
      ws.addRow(['Bu Sari', 'Nastar', 35000, 'Contoh — timpa']);
      ws.addRow(['Bu Sari', 'Kastengel', 40000, '']);
      ws.addRow(['Pak Budi', 'Keripik', '12.500', 'enak']);
    });
    const res = await readRows(f, COLS);
    expect('rows' in res && res.rows).toEqual([
      { consignor: 'Bu Sari', name: 'Kastengel', price: '40000', note: '' },
      { consignor: 'Pak Budi', name: 'Keripik', price: '12.500', note: 'enak' },
    ]);
  });

  it('error jelas kalau kolom wajib tidak ada', async () => {
    const f = await fileOf(ws => { ws.addRow(['Foo', 'Bar']); ws.addRow([1, 2]); });
    const res = await readRows(f, COLS);
    expect('error' in res && res.error).toContain('Penitip');
  });
});
