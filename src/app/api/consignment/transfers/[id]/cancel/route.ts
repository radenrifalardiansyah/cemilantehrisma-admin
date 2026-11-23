import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { cancelTransfer, revalidateTransferCaches, TransferActionError } from '@/lib/consignment-transfer-workflow';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan Transfer Stok (approved → dibatalkan): efek stok dibalik; ditolak bila stok mitra tujuan sudah kurang.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'approve');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  try {
    await cancelTransfer(id, guard);
  } catch (err) {
    if (err instanceof TransferActionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  revalidateTransferCaches({ effect: true });
  return Response.json({ ok: true });
}
