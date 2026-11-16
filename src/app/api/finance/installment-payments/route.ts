import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { fetchInstallmentPayments } from '@/lib/installment-payments-report';
import { fetchRecapPaymentRecords } from '@/lib/recap-payments-report';

// Cicilan pesanan kredit (`payments`) dan pembayaran Rekap Mitra (`recapPayments`, sudah proporsional) yang DITERIMA dalam
// periode — dipakai Laporan Keuangan.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'finance-report', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  const sql = getSql();
  const payments = await fetchInstallmentPayments(sql, from, to);
  const recapPayments = await fetchRecapPaymentRecords(sql, from, to);
  return Response.json({ payments, recapPayments });
}
