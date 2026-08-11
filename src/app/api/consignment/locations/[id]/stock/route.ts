import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

// Daftar produk yang punya stok titip di lokasi ini — dipakai form Rekap Harian & ringkasan nilai stok per lokasi.
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const { id: locationId } = await ctx.params;
  const snap = await getDb().collection('consignmentStock').where('locationId', '==', locationId).get();
  const stock = snap.docs
    .map(d => d.data())
    .filter(data => ((data.stockQty as number) ?? 0) > 0)
    .sort((a, b) => (a.productName as string).localeCompare(b.productName as string));
  return Response.json({ stock });
}
