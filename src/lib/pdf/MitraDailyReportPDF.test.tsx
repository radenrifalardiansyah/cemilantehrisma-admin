import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import MitraDailyReportPDF from './MitraDailyReportPDF';
import { buildMitraDailyReport } from '../mitra-daily-report';

describe('MitraDailyReportPDF', () => {
  it('merender beberapa mitra (termasuk yang kosong) menjadi PDF valid', async () => {
    const at = (iso: string) => ({ seconds: Math.floor(new Date(`${iso}+07:00`).getTime() / 1000) });
    const sections = buildMitraDailyReport({
      locations: [{ id: 'a', name: 'BGM 1' }, { id: 'b', name: 'BGM 2' }],
      stockByLocation: { a: [{ productId: 'p', productName: 'Keripik Pedas', stockQty: 12 }], b: [] },
      shipments: [{ locationId: 'a', createdAt: at('2026-11-01T08:00:00'), items: [{ productId: 'p', productName: 'Keripik Pedas', qty: 30 }] }],
      recaps: [{ locationId: 'a', createdAt: at('2026-11-01T17:00:00'), items: [{ productId: 'p', productName: 'Keripik Pedas', qtySold: 18, qtyRetur: 0, qtyReject: 0 }] }],
      from: '2026-11-01', to: '2026-11-01',
    });
    const buf = await renderToBuffer(<MitraDailyReportPDF store={{ name: 'Cemilan Teh Risma' } as never} data={{ periodText: '1 November 2026', generatedAt: 'now', sections }} />);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
