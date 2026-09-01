import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

interface IncomeRow {
  id: string; category: string | null; description: string | null; amount: string;
  items: unknown; date: string; note: string | null; wallet_id: string | null;
}

function toAudit(r: IncomeRow) {
  return { category: r.category, description: r.description, amount: Number(r.amount), items: r.items, date: r.date, note: r.note, walletId: r.wallet_id };
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'income', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<IncomeRow[]>`select * from income where id = ${id}`;
  const data = await req.json() as Record<string, unknown>;
  const amount = Number(data.amount) || 0;
  if (amount <= 0) return Response.json({ error: 'Jumlah harus lebih dari 0.' }, { status: 400 });
  const payload = {
    category: (data.category as string | undefined) ?? 'Lainnya',
    description: (data.description as string | undefined) ?? '',
    amount,
    items: Array.isArray(data.items) ? data.items : [],
    date: String(data.date ?? ''),
    note: (data.note as string | undefined) ?? '',
    walletId: (data.walletId as string | null | undefined) ?? null,
  };
  await sql`
    update income
    set category = ${payload.category}, description = ${payload.description}, amount = ${payload.amount},
        items = ${JSON.stringify(payload.items)}, date = ${payload.date}, note = ${payload.note},
        wallet_id = ${payload.walletId}, updated_at = now()
    where id = ${id}
  `;
  try {
    const db = getDb();
    await logHistory(db, {
      entity: 'income',
      entityId: id,
      entityLabel: `${payload.description || payload.category || 'Pemasukan'} - Rp ${Number(payload.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'update',
      actor: guard,
      before: before ? toAudit(before) : null,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for income update', err);
  }
  revalidateTag('admin-income', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'income', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<IncomeRow[]>`select * from income where id = ${id}`;
  await sql`delete from income where id = ${id}`;
  try {
    const db = getDb();
    await logHistory(db, {
      entity: 'income',
      entityId: id,
      entityLabel: before ? `${before.description || before.category || 'Pemasukan'} - Rp ${Number(before.amount ?? 0).toLocaleString('id-ID')}` : id,
      action: 'delete',
      actor: guard,
      before: before ? toAudit(before) : null,
    });
  } catch (err) {
    console.error('Failed to write history for income delete', err);
  }
  revalidateTag('admin-income', { expire: 0 });
  return Response.json({ ok: true });
}
