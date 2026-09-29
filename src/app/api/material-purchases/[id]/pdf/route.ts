import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { getSettings } from '@/lib/settings-pg';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';
import MaterialPurchaseNotePDF, { type MaterialPurchaseNoteData } from '@/lib/pdf/MaterialPurchaseNotePDF';
import type { StoreHeader } from '@/lib/pdf/ShipmentNotePDF';

// Rute publik (tanpa x-admin-auth) — link nota ini dibuka langsung dari WhatsApp (admin tidak
// membawa header auth saat tap link dari aplikasi WA), sama seperti invoice pesanan.
export const runtime = 'nodejs';

function formatDate(iso?: string) {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
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
    const [purchaseRow] = await sql<PurchaseRow[]>`select * from material_purchases where id = ${id}`;
    if (!purchaseRow) return new NextResponse('Pembelian tidak ditemukan.', { status: 404 });
    const purchase = rowToPurchase(purchaseRow);

    let walletName: string | undefined;
    if (purchase.walletId) {
      const [walletRow] = await sql<{ name: string }[]>`select name from wallets where id = ${purchase.walletId}`;
      walletName = walletRow?.name;
    }

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

    const data: MaterialPurchaseNoteData = {
      id,
      date: formatDate(purchase.date),
      printedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      supplierName: purchase.supplierName,
      items: purchase.items.map(it => ({ materialName: it.materialName, unit: it.unit, qty: it.qty, price: it.price, subtotal: it.subtotal })),
      total: purchase.total,
      paymentStatus: purchase.paymentStatus as 'lunas' | 'belum_lunas' | undefined,
      walletName,
      note: purchase.note || undefined,
      voided: purchase.voided,
      voidNote: purchase.voidNote || undefined,
    };

    const buffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(MaterialPurchaseNotePDF, { data, store }) as any,
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="nota-pembelian-${id}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[material-purchases/pdf]', err);
    return new NextResponse('Gagal membuka nota pembelian.', { status: 500 });
  }
}
