import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { logHistory } from '@/lib/history';
import { unstable_cache, revalidateTag } from 'next/cache';
import { randomUUID } from 'crypto';
import { getSql } from '@/lib/db';
import { requireSuperAdmin, requireAdminOrSuperAdmin } from '@/lib/rbac';
import { parseDateKey } from '@/lib/validate-input';
import { computeReport, collectTransactionIds, serializeInvoiceRow, type AdminFeeInvoiceRow } from '@/lib/admin-fee';

async function auditInvoice(actor: Parameters<typeof logHistory>[1]['actor'], action: 'create' | 'update', id: string, label: string, before: Record<string, unknown> | null, after: Record<string, unknown>) {
  try {
    await logHistory(getDb(), { entity: 'admin-fee', entityCollection: 'invoices', entityId: id, entityLabel: label, action, actor, before, after });
  } catch (err) { console.error('Failed to write admin-fee audit log', err); }
}

// Cached unfiltered — role-based filtering below stays outside the cache (per-request, not
// baked into the shared cached value) since which rows `admin` may see depends on the caller.
const getCachedInvoices = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<AdminFeeInvoiceRow[]>`select * from admin_fee_invoices order by created_at desc`;
    return rows.map(serializeInvoiceRow);
  },
  ['admin-fee-invoices'],
  { revalidate: 20, tags: ['admin-fee-invoices'] },
);

export async function GET(req: NextRequest) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const all = await getCachedInvoices();
  const invoices = all
    // `admin` (pemilik usaha yang ditagih) cuma boleh lihat invoice yang sudah benar-benar
    // ditagihkan — draft masih internal RMedia Solutions dan belum tentu final, dan yang
    // dibatalkan bukan lagi tagihan aktif.
    .filter(d => guard.role === 'super-admin' || !['draft', 'cancelled'].includes(d.status ?? ''));
  return Response.json({ invoices });
}

// Snapshot totals dari Laporan Biaya Admin untuk suatu periode — dibuat sekali, tidak pernah
// dihitung ulang otomatis, supaya rate yang berubah setelahnya atau koreksi data tidak mengubah
// angka yang sudah diinvoice ke client.
export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const data = await req.json() as { from?: string; to?: string; note?: string; dueDate?: string };
  const { from, to } = data;
  if (!from || !to) return Response.json({ error: 'Periode (from/to) wajib diisi.' }, { status: 400 });
  if (!parseDateKey(from, false) || !parseDateKey(to, false) || from > to) {
    return Response.json({ error: 'Periode tidak valid (format YYYY-MM-DD, from tidak boleh setelah to).' }, { status: 400 });
  }

  const sql = getSql();
  const id = randomUUID();
  const invoiceNo = `INV-ADM-${id.slice(0, 8).toUpperCase()}`;

  // computeReport (yang menentukan transaksi "belum ditagih") dan penulisan invoice ini sekarang
  // satu transaksi Postgres (sejak adminFeeInvoices juga pindah ke Postgres, Tahap 17 migrasi
  // Fase 2 — lihat plan gleaming-wondering-quokka.md) — sebelumnya ini transaksi Firestore.
  // pg_advisory_xact_lock menyerialkan pembuatan invoice (mirip pola wallet-transfers) supaya dua
  // invoice dengan periode tumpang tindih yang dibuat hampir bersamaan tidak sama-sama menagih
  // transaksi yang sama (TOCTOU).
  await sql.begin(async (pgTx) => {
    await pgTx`select pg_advisory_xact_lock(hashtext('admin_fee_invoice_create'))`;
    const report = await computeReport(from, to, pgTx);
    await pgTx`
      insert into admin_fee_invoices (
        id, invoice_no, period_from, period_to, breakdown, transaction_ids,
        total_revenue, total_fee, status, note, due_date, created_at, created_by
      ) values (
        ${id}, ${invoiceNo}, ${report.from}, ${report.to},
        ${JSON.stringify(report.breakdown)}, ${JSON.stringify(collectTransactionIds(report))},
        ${report.totalRevenue}, ${report.totalFee}, 'draft',
        ${data.note?.trim() || null}, ${data.dueDate || null}, now(), ${guard.username}
      )
    `;
  });

  await auditInvoice(guard, 'create', id, `Invoice Biaya Admin ${invoiceNo}`, null, { invoiceNo, from, to, status: 'draft' });
  revalidateTag('admin-fee-invoices', { expire: 0 });
  return Response.json({ id, invoiceNo });
}
