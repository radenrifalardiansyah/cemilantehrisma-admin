import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { rejectShipment, revalidateShipmentCaches, ShipmentActionError } from '@/lib/shipment-workflow';

type Ctx = { params: Promise<{ id: string }> };

// Tolak Kirim Stok (draft → ditolak, final). Alasan wajib. Tidak ada efek stok. Butuh aksi `approve` di menu Mitra.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'approve');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { reason?: unknown };
  const reason = typeof body.reason === 'string' ? body.reason : '';
  try {
    await rejectShipment(id, guard, reason);
  } catch (err) {
    if (err instanceof ShipmentActionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  revalidateShipmentCaches([id]);
  return Response.json({ ok: true });
}
