import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getSql } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/rbac';
import { wibDayStart } from '@/lib/date';
import { parseDateKey } from '@/lib/validate-input';
import {
  ADMIN_FEE_CHANNELS, getAllRateHistories, type AdminFeeChannel, type AdminFeeType,
} from '@/lib/admin-fee';

const toTs = (d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 });

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const rates = await getAllRateHistories();
  const serialized = Object.fromEntries(
    ADMIN_FEE_CHANNELS.map(channel => [
      channel,
      rates[channel].map(r => ({ ...r, effectiveFrom: toTs(r.effectiveFrom), createdAt: toTs(r.createdAt) })),
    ]),
  );
  return Response.json({ rates: serialized });
}

// Mengubah rate = menambah entri baru (append-only), tidak pernah menimpa entri lama — supaya
// fee yang sudah dihitung/diinvoice untuk periode lampau tidak berubah retroaktif.
export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    channel?: AdminFeeChannel; type?: AdminFeeType; value?: number; effectiveFrom?: string;
  };
  if (!data.channel || !ADMIN_FEE_CHANNELS.includes(data.channel)) {
    return Response.json({ error: 'Channel tidak valid.' }, { status: 400 });
  }
  if (data.type !== 'percent' && data.type !== 'fixed' && data.type !== 'monthly') {
    return Response.json({ error: 'Tipe biaya harus persen, nominal, atau bulanan.' }, { status: 400 });
  }
  if (data.type === 'monthly' && data.channel !== 'lapak') {
    return Response.json({ error: 'Tarif bulanan hanya untuk channel Lapak.' }, { status: 400 });
  }
  if (typeof data.value !== 'number' || !Number.isFinite(data.value) || data.value < 0) {
    return Response.json({ error: 'Nilai biaya tidak valid.' }, { status: 400 });
  }
  if (data.type === 'percent' && data.value > 100) {
    return Response.json({ error: 'Persentase biaya tidak boleh lebih dari 100.' }, { status: 400 });
  }
  const effectiveDate = parseDateKey(data.effectiveFrom);
  if (!effectiveDate) return Response.json({ error: 'Tanggal berlaku tidak valid (format YYYY-MM-DD).' }, { status: 400 });

  const sql = getSql();
  // Selalu dinormalkan ke tengah malam WIB (bukan waktu sekarang mentah) — effectiveFrom
  // dibandingkan per hari di admin-fee.ts, jadi menyimpan momen presisi-detik di sini cuma bikin
  // data mentah membingungkan kalau diperiksa langsung, walau perbandingannya sendiri sudah aman.
  const effectiveFrom = wibDayStart(effectiveDate);
  const id = randomUUID();
  await sql`
    insert into admin_fee_rates (id, channel, type, value, effective_from, created_at, created_by)
    values (${id}, ${data.channel}, ${data.type}, ${data.value}, ${effectiveFrom.toDate()}, now(), ${guard.username})
  `;

  return Response.json({ id });
}
