import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeVoucherCode } from '@/lib/voucher';
import { rowToVoucher, type VoucherRow } from '@/lib/vouchers-pg';
import { parseVoucherBody } from './parse';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const rows = await sql<VoucherRow[]>`select * from vouchers order by created_at desc`;
  return Response.json({ vouchers: rows.map(rowToVoucher) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'create');
  if (guard instanceof Response) return guard;
  const body = await req.json() as Record<string, unknown>;
  const code = normalizeVoucherCode(body.code);
  if (code.length < 3) return Response.json({ error: 'Kode voucher minimal 3 karakter (huruf/angka).' }, { status: 400 });
  const parsed = parseVoucherBody(body);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const sql = getSql();
  const [dupe] = await sql`select code from vouchers where code = ${code}`;
  if (dupe) return Response.json({ error: 'Kode voucher sudah dipakai.' }, { status: 400 });
  await sql`
    insert into vouchers (code, description, type, value, min_purchase, max_discount, valid_from, valid_until, usage_limit, is_active)
    values (${code}, ${v.description}, ${v.type}, ${v.value}, ${v.minPurchase}, ${v.maxDiscount}, ${v.validFrom}, ${v.validUntil}, ${v.usageLimit}, ${v.isActive})
  `;
  return Response.json({ code });
}
