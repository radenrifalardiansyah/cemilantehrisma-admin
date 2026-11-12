import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { ClosingError, reopenClosing } from '@/lib/closing';

type Ctx = { params: Promise<{ id: string }> };

// Buka ulang: hanya closing AKTIF paling terakhir; alasan wajib; closing_id semua itemnya dilepas
// (kembali "belum closing"), status jadi 'dibuka_ulang' — baris & snapshot nominal tetap ada.
// Closing saldo awal hanya boleh dibuka ulang Super Admin.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'product-report', 'reopen');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { reason?: string };
  const reason = String(body.reason ?? '').trim();
  if (!reason) return Response.json({ error: 'Alasan buka ulang wajib diisi.' }, { status: 400 });

  let result: Awaited<ReturnType<typeof reopenClosing>>;
  try {
    result = await reopenClosing(getSql(), { id, reason, username: guard.username, isSuperAdmin: guard.role === 'super-admin' });
  } catch (err) {
    if (err instanceof ClosingError) return Response.json({ error: err.message }, { status: 400 });
    console.error('Buka ulang closing gagal', err);
    return Response.json({ error: 'Gagal membuka ulang closing.' }, { status: 500 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'closings', entityId: id, entityLabel: `Buka ulang closing sampai ${result.periodTo}`,
      action: 'update', actor: guard, before: { status: 'aktif' }, after: { status: 'dibuka_ulang', reason, released: result.released },
    });
  } catch (err) {
    console.error('Failed to write history for closing reopen', err);
  }
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, released: result.released });
}
