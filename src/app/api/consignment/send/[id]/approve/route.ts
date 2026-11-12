import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { approveShipment, revalidateShipmentCaches, ShipmentActionError } from '@/lib/shipment-workflow';

type Ctx = { params: Promise<{ id: string }> };

// Approve Kirim Stok (draft → approved): satu-satunya titik di mana efek stok pengiriman terjadi.
// Butuh aksi `approve` di menu Mitra. Self-approval diperbolehkan.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'approve');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  try {
    await approveShipment(id, guard);
  } catch (err) {
    if (err instanceof ShipmentActionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  revalidateShipmentCaches([id], { stock: true });
  return Response.json({ ok: true });
}
