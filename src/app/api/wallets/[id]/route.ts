import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { walletHasReferences } from '@/lib/wallet-balance';
import { logHistory } from '@/lib/history';
import { rowToWallet, type WalletRow } from '@/lib/wallets-pg';

type Ctx = { params: Promise<{ id: string }> };
// camelCase (field lama Firestore) -> kolom snake_case Postgres.
const COLUMN_MAP: Record<string, string> = {
  name: 'name', type: 'type', icon: 'icon', color: 'color', initialBalance: 'initial_balance', isActive: 'is_active',
};

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();
  const [before] = await sql<WalletRow[]>`select * from wallets where id = ${id}`;

  const patch: Record<string, unknown> = {};
  if (typeof data.name === 'string' && data.name.trim()) patch.name = data.name.trim();
  if (['cash', 'bank', 'ewallet', 'other'].includes(data.type as string)) patch.type = data.type;
  if (typeof data.icon === 'string' && data.icon) patch.icon = data.icon;
  if (typeof data.color === 'string' && data.color) patch.color = data.color;
  if (data.initialBalance !== undefined) patch.initialBalance = Number(data.initialBalance) || 0;
  if (typeof data.isActive === 'boolean') patch.isActive = data.isActive;

  const sqlPatch: Record<string, unknown> = {};
  for (const [camelKey, column] of Object.entries(COLUMN_MAP)) {
    if (camelKey in patch) sqlPatch[column] = patch[camelKey];
  }
  if (Object.keys(sqlPatch).length > 0) {
    await sql`update wallets set ${sql(sqlPatch)}, updated_at = now() where id = ${id}`;
  }

  try {
    const [after] = await sql<WalletRow[]>`select * from wallets where id = ${id}`;
    await logHistory(db, {
      entity: 'wallets',
      entityId: id,
      entityLabel: after?.name ?? id,
      action: 'update',
      actor: guard,
      before: before ? rowToWallet(before) : null,
      after: after ? rowToWallet(after) : null,
    });
  } catch (err) {
    console.error('Failed to write history for wallets update', err);
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  if (await walletHasReferences(db, id)) {
    return Response.json({ error: 'Dompet ini masih punya riwayat transaksi — nonaktifkan saja, tidak bisa dihapus.' }, { status: 400 });
  }

  const [before] = await sql<WalletRow[]>`select * from wallets where id = ${id}`;
  await sql`delete from wallets where id = ${id}`;
  try {
    await logHistory(db, {
      entity: 'wallets',
      entityId: id,
      entityLabel: before?.name ?? id,
      action: 'delete',
      actor: guard,
      before: before ? rowToWallet(before) : null,
    });
  } catch (err) {
    console.error('Failed to write history for wallets delete', err);
  }
  return Response.json({ ok: true });
}
