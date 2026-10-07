import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getSql } from '@/lib/db';
import { rowToPo, type PoRow } from '@/lib/purchase-orders-pg';
import PurchaseDocPDF from '@/lib/pdf/PurchaseDocPDF';
import { poToDocData } from '@/lib/pdf/purchase-doc-data';
import { getServerStoreHeader } from '@/lib/pdf/server-store-header';
import { serverSignatureDataUri } from '@/lib/pdf/server-image';

// Rute publik (tanpa x-admin-auth) — link PO dibuka supplier langsung dari WhatsApp. Dijaga token
// acak 32 hex (bukan UUID yang bisa ditebak). Token dicek SEBELUM render, jadi permintaan asal
// tebak ditolak murah tanpa membebani CPU/Firestore. Respons boleh di-cache CDN sebentar supaya
// buka-ulang & pratinjau WA tidak merender PDF berulang (hemat invocation Vercel).
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = new URL(req.url).searchParams.get('t') ?? '';
    if (!/^[0-9a-f]{32}$/.test(token)) return new NextResponse('Link tidak valid.', { status: 404 });

    const sql = getSql();
    const [row] = await sql<PoRow[]>`
      select po.*, cp.full_name as created_by_name, cp.signature as created_by_signature
      from purchase_orders po left join profiles cp on cp.username = po.created_by
      where po.id = ${id} and po.token = ${token}
    `;
    if (!row) return new NextResponse('PO tidak ditemukan.', { status: 404 });
    const po = rowToPo(row);

    const [sup] = row.supplier_id ? await sql<{ address: string; pic: string }[]>`select address, pic from suppliers where id = ${row.supplier_id}` : [];
    const [store, createdSig] = await Promise.all([getServerStoreHeader(), serverSignatureDataUri(po.createdBySignature)]);
    const buffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(PurchaseDocPDF, { data: poToDocData({ ...po, supplierPic: sup?.pic }, sup?.address, { created: createdSig }), store }) as any,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${po.poNumber}.pdf"`,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('[purchase-orders/pdf]', err);
    return new NextResponse('Gagal membuka PO.', { status: 500 });
  }
}
