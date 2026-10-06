import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeVoucherCode } from '@/lib/voucher';
import { parseVoucherBody } from '../parse';

type Ctx = { params: Promise<{ code: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const code = normalizeVoucherCode((await ctx.params).code);
  const parsed = parseVoucherBody(await req.json() as Record<string, unknown>);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const sql = getSql();
  const rows = await sql`
    update vouchers set description = ${v.description}, type = ${v.type}, value = ${v.value},
      min_purchase = ${v.minPurchase}, max_discount = ${v.maxDiscount}, valid_from = ${v.validFrom},
      valid_until = ${v.validUntil}, usage_limit = ${v.usageLimit}, per_customer_limit = ${v.perCustomerLimit}, is_active = ${v.isActive}, updated_at = now()
    where code = ${code} returning code
  `;
  if (rows.length === 0) return Response.json({ error: 'Voucher tidak ditemukan.' }, { status: 404 });
  return Response.json({ ok: true });
}

// Voucher yang sudah pernah dipakai tidak dihapus (jejak pesanan lama merujuk kodenya) — cukup
// dinonaktifkan lewat PUT.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'delete');
  if (guard instanceof Response) return guard;
  const code = normalizeVoucherCode((await ctx.params).code);
  const sql = getSql();
  const [v] = await sql<{ used_count: number }[]>`select used_count from vouchers where code = ${code}`;
  if (!v) return Response.json({ ok: true });
  if (v.used_count > 0) return Response.json({ error: 'Voucher ini sudah pernah dipakai — nonaktifkan saja, jangan dihapus.' }, { status: 400 });
  await sql`delete from vouchers where code = ${code}`;
  return Response.json({ ok: true });
}
