import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'capital', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const amount = Number(data.amount) || 0;
  if (amount <= 0) return Response.json({ error: 'Jumlah harus lebih dari 0.' }, { status: 400 });
  const sql = getSql();
  const [before] = await sql`select * from capital_entries where id = ${id}`;
  const payload = {
    type: data.type === 'prive' ? 'prive' : 'modal',
    amount,
    date: String(data.date ?? ''),
    note: (data.note as string | undefined) ?? '',
    walletId: (data.walletId as string | null | undefined) ?? null,
  };
  await sql`
    update capital_entries
    set type = ${payload.type}, amount = ${payload.amount}, date = ${payload.date},
        note = ${payload.note}, wallet_id = ${payload.walletId}, updated_at = now()
    where id = ${id}
  `;
  try {
    const db = getDb();
    const typeLabel = payload.type === 'prive' ? 'Modal Keluar' : 'Modal Masuk';
    await logHistory(db, {
      entity: 'capital',
      entityId: id,
      entityLabel: `${typeLabel} Rp ${Number(payload.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'update',
      actor: guard,
      before: before ? { type: before.type, amount: Number(before.amount), date: before.date, note: before.note, walletId: before.wallet_id } : null,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for capital update', err);
  }
  revalidateTag('admin-capital', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'capital', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql`select * from capital_entries where id = ${id}`;
  await sql`delete from capital_entries where id = ${id}`;
  try {
    const db = getDb();
    const typeLabel = before?.type === 'prive' ? 'Modal Keluar' : 'Modal Masuk';
    await logHistory(db, {
      entity: 'capital',
      entityId: id,
      entityLabel: `${typeLabel} Rp ${Number(before?.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'delete',
      actor: guard,
      before: before ? { type: before.type, amount: Number(before.amount), date: before.date, note: before.note, walletId: before.wallet_id } : null,
    });
  } catch (err) {
    console.error('Failed to write history for capital delete', err);
  }
  revalidateTag('admin-capital', { expire: 0 });
  return Response.json({ ok: true });
}
