import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { computeVoucherDiscount, normalizeVoucherCode, voucherDiscountLabel } from '@/lib/voucher';
import { voucherProblem, voucherRule, type VoucherRow } from '@/lib/vouchers-pg';

// Dipakai Kasir untuk pratinjau voucher sebelum transaksi — pengecekan yang mengikat tetap
// diulang di server saat pesanan disimpan (POST /api/orders).
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, ['pos', 'orders'], 'create');
  if (guard instanceof Response) return guard;
  const body = await req.json() as { code?: string; subtotal?: number };
  const code = normalizeVoucherCode(body.code);
  const subtotal = Number(body.subtotal) || 0;
  if (!code) return Response.json({ error: 'Masukkan kode voucher.' }, { status: 400 });
  const sql = getSql();
  const [row] = await sql<VoucherRow[]>`select * from vouchers where code = ${code}`;
  const problem = voucherProblem(row, subtotal);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  const rule = voucherRule(row);
  return Response.json({ code, rule, amount: computeVoucherDiscount(rule, subtotal), label: voucherDiscountLabel(code) });
}
