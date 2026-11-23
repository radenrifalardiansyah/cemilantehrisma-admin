import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { writeFileSync } from 'node:fs';
import MitraDailyReportPDF from './MitraDailyReportPDF';
import { buildMitraDailyReport } from '../mitra-daily-report';

const at = (iso: string) => ({ seconds: Math.floor(new Date(`${iso}+07:00`).getTime() / 1000) });
const item = (id: string, name: string, qty: number, harga: number) => ({ productId: id, productName: name, qty, hargaTitip: harga, subtotal: qty * harga });
const ritem = (id: string, name: string, sold: number, retur: number, reject: number, harga: number) => ({ productId: id, productName: name, qtySold: sold, qtyRetur: retur, qtyReject: reject, hargaTitip: harga, revenue: sold * harga });

function build(from: string, to: string, withTransfer = false) {
  return buildMitraDailyReport({
    locations: [{ id: 'a', name: 'BGM 1' }, { id: 'b', name: 'BGM 2' }, { id: 'c', name: 'Mba' }],
    stockByLocation: {
      a: [{ productId: 'p1', productName: 'Keripik Pedas', stockQty: 12, hargaTitip: 8500 }, { productId: 'p2', productName: 'Basreng Original', stockQty: 5, hargaTitip: 12000 }],
      b: [{ productId: 'p1', productName: 'Keripik Pedas', stockQty: 3, hargaTitip: 8500 }], c: [],
    },
    shipments: [
      { locationId: 'a', createdAt: at('2026-11-01T08:00:00'), items: [item('p1', 'Keripik Pedas', 30, 8500), item('p2', 'Basreng Original', 10, 12000)] },
      { locationId: 'a', createdAt: at('2026-11-02T08:00:00'), items: [item('p1', 'Keripik Pedas', 20, 8500)] },
      { locationId: 'b', createdAt: at('2026-11-01T09:00:00'), items: [item('p1', 'Keripik Pedas', 10, 8500)] },
    ],
    recaps: [
      { locationId: 'a', createdAt: at('2026-11-01T17:00:00'), items: [ritem('p1', 'Keripik Pedas', 18, 2, 1, 8500), ritem('p2', 'Basreng Original', 5, 0, 0, 12000)] },
      { locationId: 'b', createdAt: at('2026-11-01T17:30:00'), items: [ritem('p1', 'Keripik Pedas', 7, 0, 0, 8500)] },
    ],
    transfers: withTransfer ? [
      { status: 'approved', fromLocationId: 'a', toLocationId: 'b', docDate: at('2026-11-02T10:00:00'), items: [{ productId: 'p1', productName: 'Keripik Pedas', qty: 4, hargaTitip: 8500 }] },
    ] : [],
    from, to,
  }).map(s => ({ ...s, code: 'MTR001' }));
}

const store = { name: 'Cemilan Teh Risma', tagline: 'Camilan khas rumahan', address: 'Jl. Contoh No. 12, Bandung', phone: '081234567890' } as never;

describe('MitraDailyReportPDF', () => {
  it('merender banyak mitra (ringkasan + detail multi-hari + mitra kosong) menjadi PDF valid', async () => {
    const buf = await renderToBuffer(<MitraDailyReportPDF store={store} data={{ from: '2026-11-01', to: '2026-11-02', generatedAt: 'now', sections: build('2026-11-01', '2026-11-02') }} />);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/multi.pdf`, buf);
  });
  it('merender satu mitra satu hari', async () => {
    const buf = await renderToBuffer(<MitraDailyReportPDF store={store} data={{ from: '2026-11-01', to: '2026-11-01', generatedAt: 'now', sections: build('2026-11-01', '2026-11-01').slice(0, 1) }} />);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/single.pdf`, buf);
  });
  it('merender PDF ringkasan saja (banyak mitra & satu mitra)', async () => {
    const multi = await renderToBuffer(<MitraDailyReportPDF store={store} data={{ from: '2026-11-01', to: '2026-11-02', generatedAt: 'now', summaryOnly: true, sections: build('2026-11-01', '2026-11-02') }} />);
    expect(multi.subarray(0, 4).toString()).toBe('%PDF');
    const one = await renderToBuffer(<MitraDailyReportPDF store={store} data={{ from: '2026-11-01', to: '2026-11-02', generatedAt: 'now', summaryOnly: true, sections: build('2026-11-01', '2026-11-02').slice(0, 1) }} />);
    expect(one.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) { writeFileSync(`${process.env.PDF_OUT}/sum_multi.pdf`, multi); writeFileSync(`${process.env.PDF_OUT}/sum_one.pdf`, one); }
  });
  it('merender transfer antar mitra: data transfer ada di laporan dan PDF tetap valid', async () => {
    const sections = build('2026-11-01', '2026-11-02', true);
    expect(sections.find(x => x.locationId === 'a')?.totals.transferKeluar).toBe(4);
    expect(sections.find(x => x.locationId === 'b')?.totals.transferMasuk).toBe(4);
    const full = await renderToBuffer(<MitraDailyReportPDF store={store} data={{ from: '2026-11-01', to: '2026-11-02', generatedAt: 'now', sections }} />);
    expect(full.subarray(0, 4).toString()).toBe('%PDF');
    const sumOnly = await renderToBuffer(<MitraDailyReportPDF store={store} data={{ from: '2026-11-01', to: '2026-11-02', generatedAt: 'now', summaryOnly: true, sections }} />);
    expect(sumOnly.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/transfer.pdf`, full);
  });
});
