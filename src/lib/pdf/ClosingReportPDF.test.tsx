import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { writeFileSync } from 'node:fs';
import ClosingReportPDF from './ClosingReportPDF';
import { closingToPdfData, draftToPdfData, type ClosingRecord } from './closing-pdf-data';
import type { ClosingLine } from '@/lib/closing';

const store = { name: 'Cemilan Teh Risma', tagline: 'Camilan khas rumahan', address: 'Jl. Contoh No. 12, Bandung', phone: '081234567890' };

const mk = (i: number, paid: boolean): ClosingLine => ({
  key: `order:${i}`, kind: i % 5 === 0 ? 'recap' : 'order', invoiceNo: i % 5 === 0 ? 'Rekap Mitra' : `INV-2026-${String(i).padStart(4, '0')}`,
  party: i % 5 === 0 ? 'Lapak Mitra Contoh' : ['Budi Santoso', 'Siti Aminah', 'Toko Berkah Jaya'][i % 3], txDate: `2026-11-${String(1 + (i % 10)).padStart(2, '0')}`,
  paidDate: paid ? `2026-11-${String(2 + (i % 10)).padStart(2, '0')}` : null, qty: 1 + (i % 7), cogs: 1500 * (1 + (i % 7)), revenue: 4000 * (1 + (i % 7)),
  note: i % 4 === 0 ? 'Cicilan 50%' : undefined,
});
const many = (n: number, paid: boolean) => Array.from({ length: n }, (_, i) => mk(i + 1, paid));
const closingRec = (over: Partial<ClosingRecord> = {}): ClosingRecord => ({
  id: 'abcdef12-0000-0000-0000-000000000000', period_from: '2026-11-01', period_to: '2026-11-11', closed_at: new Date('2026-11-12T03:00:00Z'), closed_by: 'rifal',
  total_qty: null, total_cogs: null, total_revenue: null, item_count: 0, note: 'Closing harian contoh', status: 'aktif', reopened_at: null, reopened_by: null, reopen_reason: null, is_opening_balance: false, ...over,
});

async function render(data: ReturnType<typeof draftToPdfData>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(React.createElement(ClosingReportPDF, { data, store }) as any);
}
const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe('ClosingReportPDF', () => {
  it('merender draf (banyak baris → beberapa halaman), closing, dibuka ulang, dan saldo awal menjadi PDF valid', async () => {
    const paid = many(120, true), recv = many(15, false);
    const out = process.env.PDF_OUT;
    const draft = await render(draftToPdfData({ upTo: '2026-11-12', today: '2026-11-12', lastClosingTo: '2026-10-31', paid, receivable: recv }));
    expect(draft.subarray(0, 4).toString()).toBe('%PDF');
    expect(pages(draft)).toBeGreaterThan(2);
    if (out) writeFileSync(`${out}/draf-closing-hpp.pdf`, draft);

    const lines = many(30, true);
    const sum = lines.reduce((a, l) => ({ q: a.q + l.qty, c: a.c + l.cogs, r: a.r + l.revenue }), { q: 0, c: 0, r: 0 });
    const official = await render(closingToPdfData(closingRec({ total_qty: String(sum.q), total_cogs: String(sum.c + 1), total_revenue: String(sum.r), item_count: 30 }), lines));
    expect(official.subarray(0, 4).toString()).toBe('%PDF');
    if (out) writeFileSync(`${out}/closing-hpp.pdf`, official);

    const reopened = await render(closingToPdfData(closingRec({ status: 'dibuka_ulang', reopened_by: 'admin', reopened_at: new Date('2026-11-13T02:00:00Z'), reopen_reason: 'Salah input qty', total_qty: '10', total_cogs: '15000', total_revenue: '40000', item_count: 4 }), []));
    expect(reopened.subarray(0, 4).toString()).toBe('%PDF');

    const opening = await render(closingToPdfData(closingRec({ is_opening_balance: true, period_from: null, item_count: 312 }), []));
    expect(opening.subarray(0, 4).toString()).toBe('%PDF');
    if (out) writeFileSync(`${out}/closing-saldo-awal.pdf`, opening);
  }, 60_000);

  it('draf kosong tidak error', async () => {
    const b = await render(draftToPdfData({ upTo: null, today: '2026-11-12', lastClosingTo: null, paid: [], receivable: [] }));
    expect(b.subarray(0, 4).toString()).toBe('%PDF');
  });
});
