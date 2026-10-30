import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { fetchInstallmentPayments } from '@/lib/installment-payments-report';

// Cicilan pesanan kredit yang DITERIMA dalam periode — dipakai Laporan Keuangan.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'finance-report', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  return Response.json({ payments: await fetchInstallmentPayments(getSql(), from, to) });
}
