import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';

type Ctx = { params: Promise<{ id: string }> };

// Daftar produk yang punya stok titip di lokasi ini — dipakai form Rekap Harian & ringkasan nilai stok per lokasi.
export async function GET(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id: locationId } = await ctx.params;
  const snap = await getDb().collection('consignmentStock').where('locationId', '==', locationId).get();
  const stock = snap.docs
    .map(d => d.data())
    .filter(data => ((data.stockQty as number) ?? 0) > 0)
    .sort((a, b) => (a.productName as string).localeCompare(b.productName as string));
  return Response.json({ stock });
}
