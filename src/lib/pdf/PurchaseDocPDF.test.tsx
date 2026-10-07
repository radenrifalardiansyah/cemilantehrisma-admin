import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { writeFileSync } from 'node:fs';
import PurchaseDocPDF, { PurchaseDocBundle } from './PurchaseDocPDF';
import { poToDocData, grToDocData } from './purchase-doc-data';

const store = { name: 'Cemilan Teh Risma', tagline: 'Camilan khas rumahan', address: 'Jl. Contoh No. 12, Bandung', phone: '081234567890', ownerName: 'Risma' };
const items = [
  { materialId: 'a', materialName: 'Mie Superior Spider', unit: 'ikat', qty: 5, price: 45000, subtotal: 225000, orderedQty: 10 },
  { materialId: 'b', materialName: 'Tepung Terigu Segitiga Biru', unit: 'kg', qty: 25, price: 12000, subtotal: 300000, orderedQty: 25 },
];
const gr = { grNumber: 'GR-202610-0001', doNumber: 'DO-SUP001-202610-0001', poNumber: 'PO-202610-0001', supplierName: 'PT. FKS Food Sejahtera Tbk', items, total: 525000, receivedDate: '2026-10-07', note: 'Kemasan baik', status: 'approved' as const, cancelNote: null, createdBy: 'rifal', approvedBy: 'admin', approvedAt: { seconds: 1791331200 }, paymentStatus: 'belum_lunas' };

describe('PurchaseDocPDF', () => {
  it('merender PO, GR, dan DO menjadi PDF valid', async () => {
    const poBase = { poNumber: 'PO-202610-0001', supplierName: 'PT. FKS Food Sejahtera Tbk', supplierPhone: '081200000000', items, total: 525000, date: '2026-10-06', expectedDate: '2026-10-10', note: 'Kirim pagi hari', status: 'draft' as const, cancelNote: null, createdBy: 'rifal' };
    const docs: Record<string, ReturnType<typeof poToDocData>> = {
      po: poToDocData(poBase, 'Jl. Industri Raya Blok C-12, Cikarang, Bekasi'),
      po_batal: poToDocData({ ...poBase, status: 'batal', cancelNote: 'Salah supplier' }),
      gr: grToDocData(gr, 'gr', { address: 'Jl. Industri Raya Blok C-12, Cikarang', phone: '081200000000' }),
      do: grToDocData(gr, 'do'),
      gr_draft: grToDocData({ ...gr, status: 'draft', approvedBy: null, approvedAt: null }, 'gr'),
    };
    for (const [name, data] of Object.entries(docs)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buf = await renderToBuffer(React.createElement(PurchaseDocPDF, { data, store }) as any);
      expect(buf.subarray(0, 4).toString()).toBe('%PDF');
      if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/${name}.pdf`, buf);
    }
  });

  it('PDF gabungan: satu dokumen per halaman', async () => {
    const mk = (n: string) => poToDocData({ poNumber: n, supplierName: 'CV Uji', supplierPhone: '', items, total: 525000, date: '2026-10-06', expectedDate: null, note: '', status: 'terkirim', cancelNote: null }, undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = await renderToBuffer(React.createElement(PurchaseDocBundle, { docs: [mk('PO-A'), mk('PO-B'), mk('PO-C')], store, title: 'uji' }) as any);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/bundle.pdf`, buf);
  });
});
