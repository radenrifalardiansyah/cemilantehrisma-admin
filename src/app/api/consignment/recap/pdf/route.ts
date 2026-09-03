import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { Document, renderToBuffer } from '@react-pdf/renderer';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { getSettings } from '@/lib/settings-pg';
import { rowToRecap, type RecapRow } from '@/lib/recaps-pg';
import { RecapNotePDFPage, type RecapNoteItem } from '@/lib/pdf/RecapNotePDF';
import type { StoreHeader } from '@/lib/pdf/ShipmentNotePDF';
import { groupAndMergeRecaps, type MergeableRecap } from '@/lib/consignment-recap-merge';

// Rute publik (tanpa x-admin-auth) — link nota rekap ini dibuka langsung oleh mitra dari
// WhatsApp. `ids` bisa berisi beberapa rekap sekaligus (dipisah koma): kalau semuanya dari
// mitra yang sama dijadikan satu halaman ringkasan gabungan (sama seperti export PDF gabungan
// di tab Rekap), kalau campur beberapa mitra tiap mitra tetap dapat halamannya sendiri.
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

export async function GET(req: NextRequest) {
  try {
    const idsParam = req.nextUrl.searchParams.get('ids') ?? '';
    const ids = [...new Set(idsParam.split(',').map(s => s.trim()).filter(Boolean))];
    if (ids.length === 0) return new NextResponse('Rekap tidak ditemukan.', { status: 404 });

    const db = getDb();
    const sql = getSql();
    const recapRows = await sql<RecapRow[]>`select * from consignment_recaps where id in ${sql(ids)}`;
    if (recapRows.length === 0) return new NextResponse('Rekap tidak ditemukan.', { status: 404 });

    const recaps: MergeableRecap[] = recapRows.map(row => {
      const r = rowToRecap(row);
      return {
        id: r.id,
        locationId: r.locationId,
        locationName: r.locationName,
        items: r.items as RecapNoteItem[],
        note: r.note,
        paymentStatus: r.paymentStatus,
        warehouseName: r.warehouseName,
        createdAt: r.createdAt ?? undefined,
      };
    });

    const locationIds = [...new Set(recaps.map(r => r.locationId).filter((v): v is string => !!v))];
    const locationRows = locationIds.length > 0
      ? await sql<{ id: string; code: string | null }[]>`select id, code from consignment_locations where id in ${sql(locationIds)}`
      : [];
    const codeById = new Map(locationRows.map(l => [l.id, l.code ?? undefined]));

    const settings = await getSettings() as {
      storeName?: string; storeTagline?: string; ownerName?: string;
      ownerSignature?: string; ownerStamp?: string; address?: string; city?: string;
      whatsapp?: string; logo?: string;
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

    const groups = groupAndMergeRecaps(recaps, locationId => codeById.get(locationId));

    const buffer = await renderToBuffer(
      React.createElement(
        Document,
        null,
        groups.map((g, i) => React.createElement(RecapNotePDFPage, { key: i, data: g.data, store })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="rekap-konsinyasi-${ids.length > 1 ? 'gabungan' : ids[0]}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[consignment/recap/pdf]', err);
    return new NextResponse('Gagal membuka rekap.', { status: 500 });
  }
}
