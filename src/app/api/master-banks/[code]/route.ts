import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ code: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { code } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (typeof data.name === 'string' && data.name.trim()) patch.name = data.name.trim();
  if ('bankCode' in data) patch.bank_code = typeof data.bankCode === 'string' && data.bankCode.trim() ? data.bankCode.trim() : null;
  if (typeof data.ewallet === 'boolean') patch.ewallet = data.ewallet;
  if ('logoUrl' in data) patch.logo_url = typeof data.logoUrl === 'string' && data.logoUrl.trim() ? data.logoUrl.trim() : null;

  const sql = getSql();
  if (Object.keys(patch).length > 0) {
    await sql`update master_banks set ${sql(patch)} where code = ${code}`;
  }
  revalidateTag('admin-master-banks', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'delete');
  if (guard instanceof Response) return guard;
  const { code } = await ctx.params;
  const sql = getSql();
  await sql`delete from master_banks where code = ${code}`;
  revalidateTag('admin-master-banks', { expire: 0 });
  return Response.json({ ok: true });
}
