import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { getSettings } from '@/lib/settings-pg';
import { rowToRecap, type RecapRow } from '@/lib/recaps-pg';
import { rowToShipment, type ShipmentRow } from '@/lib/shipments-pg';
import MitraInvoicePDF from '@/lib/pdf/MitraInvoicePDF';
import type { StoreHeader } from '@/lib/pdf/ShipmentNotePDF';
import type { RecapNoteItem } from '@/lib/pdf/RecapNotePDF';
import { buildMitraInvoiceData } from '@/lib/mitra-invoice';

// Rute publik (tanpa x-admin-auth) — link invoice ini dikirim ke mitra lewat WhatsApp. Selalu
// dihitung ulang dari data terbaru (no-store) supaya jumlah tagihan tidak basi setelah ada
// rekap baru atau pembayaran.
export const runtime = 'nodejs';

async function resolveLogoDataUri(db: ReturnType<typeof getDb>, logoUrl?: string) {
  if (!logoUrl) return undefined;
  const match = logoUrl.match(/\/api\/img\/([^/?#]+)/);
  if (!match) return logoUrl;
  const doc = await db.collection('images').doc(match[1]).get();
  if (!doc.exists) return undefined;
  const { data, contentType } = doc.data() as { data: Buffer; contentType?: string };
  return `data:${contentType || 'image/jpeg'};base64,${Buffer.from(data).toString('base64')}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ locationId: string }> }) {
  try {
    const { locationId } = await params;
    const dateParam = (k: string) => { const v = req.nextUrl.searchParams.get(k) ?? ''; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined; };
    const from = dateParam('from');
    const to = dateParam('to');
    const db = getDb();
    const sql = getSql();
    const [loc] = await sql<{ id: string; name: string; code: string | null; contact_name: string | null; contact_phone: string | null; address: string | null }[]>`
      select id, name, code, contact_name, contact_phone, address from consignment_locations where id = ${locationId}
    `;
    if (!loc) return new NextResponse('Invoice tidak ditemukan.', { status: 404 });

    const [shipmentRows, recapRows, settingsRaw] = await Promise.all([
      sql<ShipmentRow[]>`select * from consignment_shipments where location_id = ${locationId}`,
      sql<RecapRow[]>`select * from consignment_recaps where location_id = ${locationId}`,
      getSettings(),
    ]);
    const settings = settingsRaw as {
      storeName?: string; storeTagline?: string; ownerName?: string; ownerSignature?: string; ownerStamp?: string;
      address?: string; city?: string; whatsapp?: string; logo?: string;
      storeBankName?: string; storeBankAccountNumber?: string; storeBankAccountHolder?: string;
    };
    const store: StoreHeader = {
      name: settings.storeName?.trim() || 'Cemilan Teh Risma',
      tagline: settings.storeTagline?.trim() || undefined,
      ownerName: settings.ownerName?.trim() || undefined,
      ownerSignature: await resolveLogoDataUri(db, settings.ownerSignature),
      ownerStamp: await resolveLogoDataUri(db, settings.ownerStamp),
      address: [settings.address, settings.city].filter(Boolean).join(', ') || undefined,
      phone: settings.whatsapp?.trim() || undefined,
      logo: await resolveLogoDataUri(db, settings.logo),
    };
    const bankNo = settings.storeBankAccountNumber?.trim();

    const data = buildMitraInvoiceData({
      from, to,
      location: { id: loc.id, name: loc.name, code: loc.code, contactName: loc.contact_name, contactPhone: loc.contact_phone, address: loc.address },
      shipments: shipmentRows.map(rowToShipment),
      recaps: recapRows.map(row => {
        const r = rowToRecap(row);
        return { ...r, items: r.items as RecapNoteItem[] };
      }),
      bank: bankNo ? { name: settings.storeBankName?.trim() || 'Bank', accountNumber: bankNo, accountHolder: settings.storeBankAccountHolder?.trim() || undefined } : undefined,
    });

    const buffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(MitraInvoicePDF, { data, store }) as any,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${data.docNo}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[consignment/invoice/pdf]', err);
    return new NextResponse('Gagal membuka invoice.', { status: 500 });
  }
}
