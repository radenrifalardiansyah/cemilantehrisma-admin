import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { getSettings } from '@/lib/settings-pg';
import { rowToOrder, type OrderRow } from '@/lib/orders-pg';
import OrderInvoicePDF, { type OrderInvoiceData } from '@/lib/pdf/OrderInvoicePDF';
import type { StoreHeader } from '@/lib/pdf/ShipmentNotePDF';

// Rute publik (tanpa x-admin-auth) — link invoice ini dibuka langsung oleh pelanggan dari
// WhatsApp, sama seperti nota kirim konsinyasi. Tidak di-cache (order bisa diedit/ditandai
// lunas setelah dibuat), jadi tiap request selalu render ulang dari data terbaru.
export const runtime = 'nodejs';

function formatDate(seconds?: number | null, fallback?: string) {
  if (seconds) {
    return new Date(seconds * 1000).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  return fallback || '–';
}

async function resolveLogoDataUri(db: ReturnType<typeof getDb>, logoUrl?: string) {
  if (!logoUrl) return undefined;
  const match = logoUrl.match(/\/api\/img\/([^/?#]+)/);
  if (!match) return logoUrl;
  const doc = await db.collection('images').doc(match[1]).get();
  if (!doc.exists) return undefined;
  const { data, contentType } = doc.data() as { data: Buffer; contentType?: string };
  return `data:${contentType || 'image/jpeg'};base64,${Buffer.from(data).toString('base64')}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();
    const sql = getSql();
    const [orderRow] = await sql<OrderRow[]>`select * from orders where id = ${id}`;
    if (!orderRow) return new NextResponse('Pesanan tidak ditemukan.', { status: 404 });
    const order = rowToOrder(orderRow);

    const settings = await getSettings() as {
      storeName?: string; storeTagline?: string; address?: string; city?: string;
      whatsapp?: string; logo?: string;
    };
    const store: StoreHeader = {
      name: settings.storeName?.trim() || 'Cemilan Teh Risma',
      tagline: settings.storeTagline?.trim() || undefined,
      address: [settings.address, settings.city].filter(Boolean).join(', ') || undefined,
      phone: settings.whatsapp?.trim() || undefined,
      logo: await resolveLogoDataUri(db, settings.logo),
    };

    const data: OrderInvoiceData = {
      invoiceNo:      order.invoiceNo || id,
      date:           formatDate(order.createdAt?.seconds, order.date),
      printedAt:      new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      customerName:   order.customerName,
      customerPhone:  order.customerPhone || undefined,
      deliveryMethod: order.deliveryMethod as 'pickup' | 'delivery' | undefined,
      address:        order.address,
      note:           order.note,
      items:          order.items as OrderInvoiceData['items'],
      subtotal:       order.subtotal,
      discount:       order.discount as OrderInvoiceData['discount'],
      total:          order.total,
      paymentMethod:  order.paymentMethod as OrderInvoiceData['paymentMethod'],
      paymentStatus:  order.paymentStatus as OrderInvoiceData['paymentStatus'],
      amountPaid:     order.amountPaid,
      changeAmount:   order.changeAmount,
      transferBank:   order.transferBank,
      transferAmount: order.transferAmount,
    };

    const buffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(OrderInvoicePDF, { data, store }) as any,
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${data.invoiceNo}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[orders/pdf]', err);
    return new NextResponse('Gagal membuka invoice.', { status: 500 });
  }
}
