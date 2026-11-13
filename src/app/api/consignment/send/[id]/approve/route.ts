import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { approveShipmentDb, revalidateShipmentCaches, scheduleApproveEffects, ShipmentActionError } from '@/lib/shipment-workflow';

type Ctx = { params: Promise<{ id: string }> };

// Approve Kirim Stok (draft → approved): satu-satunya titik di mana efek stok pengiriman terjadi.
// Butuh aksi `approve` di menu Mitra. Self-approval diperbolehkan.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'approve');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  let runEffects: () => Promise<void>;
  try {
    ({ runEffects } = await approveShipmentDb(id, guard));
  } catch (err) {
    if (err instanceof ShipmentActionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  revalidateShipmentCaches([id], { stock: true });
  // Riwayat/notifikasi/low-stock dijalankan setelah respons (cache sudah dibuang di atas, jadi daftar langsung mutakhir).
  await scheduleApproveEffects([runEffects]);
  return Response.json({ ok: true });
}
