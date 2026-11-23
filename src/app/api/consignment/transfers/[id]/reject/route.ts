import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { rejectTransfer, revalidateTransferCaches, TransferActionError } from '@/lib/consignment-transfer-workflow';

type Ctx = { params: Promise<{ id: string }> };

// Tolak Transfer Stok (draft → ditolak, final). Alasan opsional. Tidak ada efek stok.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'approve');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { reason?: unknown };
  const reason = typeof body.reason === 'string' ? body.reason : '';
  try {
    await rejectTransfer(id, guard, reason);
  } catch (err) {
    if (err instanceof TransferActionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  revalidateTransferCaches();
  return Response.json({ ok: true });
}
