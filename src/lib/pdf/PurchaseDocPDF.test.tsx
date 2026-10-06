import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import PurchaseDocPDF from './PurchaseDocPDF';
import { poToDocData, grToDocData } from './purchase-doc-data';

const store = { name: 'Toko Uji' };
const items = [{ materialId: 'a', materialName: 'Tepung', unit: 'kg', qty: 6, price: 12000, subtotal: 72000, orderedQty: 10 }];

describe('PurchaseDocPDF', () => {
  it('merender PO, GR, dan DO menjadi PDF valid', async () => {
    const po = poToDocData({ poNumber: 'PO-202610-0001', supplierName: 'CV Uji', supplierPhone: '0812', items, total: 72000, date: '2026-10-06', expectedDate: null, note: '', status: 'draft', cancelNote: null });
    const gr = { grNumber: 'GR-202610-0001', doNumber: 'DO-SUP001-202610-0001', poNumber: 'PO-202610-0001', supplierName: 'CV Uji', items, total: 72000, receivedDate: '2026-10-07', note: 'ok', status: 'approved' as const, cancelNote: null };
    for (const data of [po, grToDocData(gr, 'gr'), grToDocData(gr, 'do'), grToDocData({ ...gr, status: 'dibatalkan', cancelNote: 'salah' }, 'gr')]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buf = await renderToBuffer(React.createElement(PurchaseDocPDF, { data, store }) as any);
      expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});
