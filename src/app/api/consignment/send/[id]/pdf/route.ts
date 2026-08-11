import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDb } from '@/lib/firebase-admin';
import ShipmentNotePDF, { type ShipmentNoteData, type StoreHeader } from '@/lib/pdf/ShipmentNotePDF';

// Rute publik (tanpa x-admin-auth) — link nota ini dibuka langsung oleh mitra dari WhatsApp.
export const runtime = 'nodejs';

function formatDate(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Logo tersimpan sebagai URL ke /api/img/{id} (bytes di Firestore). Server-side render
// tidak boleh fetch balik ke domainnya sendiri lewat HTTP — bisa gagal (cold start/DNS)
// dan @react-pdf menelan error itu diam-diam, jadi kotak logo tampil kosong. Ambil langsung
// dari Firestore dan ubah jadi data URI supaya tidak butuh network round-trip.
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
    const shipDoc = await db.collection('consignmentShipments').doc(id).get();
    if (!shipDoc.exists) return new NextResponse('Nota tidak ditemukan.', { status: 404 });
    const shipment = shipDoc.data()!;

    const [locationDoc, settingsDoc] = await Promise.all([
      shipment.locationId
        ? db.collection('consignmentLocations').doc(shipment.locationId).get()
        : Promise.resolve(null),
      db.collection('settings').doc('main').get(),
    ]);
    const location = locationDoc?.exists ? locationDoc.data()! : null;
    const settings = settingsDoc.exists ? settingsDoc.data()! : {};

    const createdAt = shipment.createdAt as { seconds?: number } | undefined;
    const items = (shipment.items ?? []) as ShipmentNoteData['items'];
    const total = items.reduce((sum, it) => sum + it.subtotal, 0);

    const store: StoreHeader = {
      name: settings.storeName?.trim() || 'Cemilan Teh Risma',
      tagline: settings.storeTagline?.trim() || undefined,
      address: [settings.address, settings.city].filter(Boolean).join(', ') || undefined,
      phone: settings.whatsapp?.trim() || undefined,
      logo: await resolveLogoDataUri(db, settings.logo),
    };

    const data: ShipmentNoteData = {
      locationName: shipment.locationName,
      contactName: location?.contactName || undefined,
      contactPhone: location?.contactPhone || undefined,
      address: location?.address || undefined,
      warehouseName: shipment.warehouseName || undefined,
      date: formatDate(createdAt?.seconds),
      docNo: `KRM-${id.slice(-6).toUpperCase()}`,
      note: shipment.note || undefined,
      items,
      total,
    };

    const buffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(ShipmentNotePDF, { data, store }) as any,
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="nota-kirim-${id}.pdf"`,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    console.error('[consignment/send/pdf]', err);
    return new NextResponse('Gagal membuka nota.', { status: 500 });
  }
}
