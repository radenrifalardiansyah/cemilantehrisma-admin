import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

// Tandai Lunas — pendapatan konsinyasi dibaca langsung dari totalRevenue rekap ini di Laporan
// Keuangan, jadi menandai lunas cukup flip status (tidak perlu bikin dokumen tambahan).
export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  await getDb().collection('consignmentRecaps').doc(id).update({
    paymentStatus: 'lunas',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}
