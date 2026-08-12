import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requireSuperAdmin } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { wibDayStart, wibDateKey } from '@/lib/date';
import {
  ADMIN_FEE_CHANNELS, getAllRateHistories, type AdminFeeChannel, type AdminFeeType,
} from '@/lib/admin-fee';

// Timestamp Firestore tidak serialize rapi lewat Response.json() — dikonversi ke
// {seconds,nanoseconds} biasa, mengikuti konvensi orders/consignment-recap route.
const serializeTs = (t: Timestamp | undefined) => t ? { seconds: t.seconds, nanoseconds: t.nanoseconds } : null;

export async function GET(req: NextRequest) {
  const guard = requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const rates = await getAllRateHistories(getDb());
  const serialized = Object.fromEntries(
    ADMIN_FEE_CHANNELS.map(channel => [
      channel,
      rates[channel].map(r => ({ ...r, effectiveFrom: serializeTs(r.effectiveFrom), createdAt: serializeTs(r.createdAt) })),
    ]),
  );
  return Response.json({ rates: serialized });
}

// Mengubah rate = menambah entri baru (append-only), tidak pernah menimpa entri lama — supaya
// fee yang sudah dihitung/diinvoice untuk periode lampau tidak berubah retroaktif.
export async function POST(req: NextRequest) {
  const guard = requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    channel?: AdminFeeChannel; type?: AdminFeeType; value?: number; effectiveFrom?: string;
  };
  if (!data.channel || !ADMIN_FEE_CHANNELS.includes(data.channel)) {
    return Response.json({ error: 'Channel tidak valid.' }, { status: 400 });
  }
  if (data.type !== 'percent' && data.type !== 'fixed') {
    return Response.json({ error: 'Tipe biaya harus persen atau nominal.' }, { status: 400 });
  }
  if (typeof data.value !== 'number' || data.value < 0) {
    return Response.json({ error: 'Nilai biaya tidak valid.' }, { status: 400 });
  }

  const db = getDb();
  // Selalu dinormalkan ke tengah malam WIB (bukan Timestamp.now() mentah) — effectiveFrom
  // dibandingkan per hari di admin-fee.ts, jadi menyimpan momen presisi-detik di sini cuma bikin
  // data mentah membingungkan kalau diperiksa langsung, walau perbandingannya sendiri sudah aman.
  const effectiveFrom = wibDayStart(data.effectiveFrom ?? wibDateKey(new Date()));
  const ref = await db.collection('adminFeeRates').add({
    channel: data.channel,
    type: data.type,
    value: data.value,
    effectiveFrom,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: guard.username,
  });

  return Response.json({ id: ref.id });
}
