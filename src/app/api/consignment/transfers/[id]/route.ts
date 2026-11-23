import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { updateTransferDraft, deleteTransfer, revalidateTransferCaches, TransferActionError, type TransferBody } from '@/lib/consignment-transfer-workflow';

type Ctx = { params: Promise<{ id: string }> };

// Edit: hanya draft (approved tidak bisa diedit — batalkan lalu buat baru).
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as TransferBody | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'Body tidak valid.' }, { status: 400 });
  try {
    await updateTransferDraft(id, body, guard);
  } catch (err) {
    if (err instanceof TransferActionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  revalidateTransferCaches();
  return Response.json({ ok: true });
}

// Hapus: hanya draft / ditolak / dibatalkan; approved → 409.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  try {
    await deleteTransfer(id, guard);
  } catch (err) {
    if (err instanceof TransferActionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  revalidateTransferCaches();
  return Response.json({ ok: true });
}
