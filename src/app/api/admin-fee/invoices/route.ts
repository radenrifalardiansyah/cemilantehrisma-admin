import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requireSuperAdmin, requireAdminOrSuperAdmin } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { computeReport, collectTransactionIds } from '@/lib/admin-fee';

export async function GET(req: NextRequest) {
  const guard = requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const snap = await getDb().collection('adminFeeInvoices').orderBy('createdAt', 'desc').get();
  const invoices = snap.docs
    // `admin` (pemilik usaha yang ditagih) cuma boleh lihat invoice yang sudah benar-benar
    // ditagihkan — draft masih internal RMedia Solutions dan belum tentu final, dan yang
    // dibatalkan bukan lagi tagihan aktif.
    .filter(d => guard.role === 'super-admin' || !['draft', 'cancelled'].includes(d.data().status))
    .map(d => {
      const data = d.data();
      const createdAt = data.createdAt as Timestamp | undefined;
      return { id: d.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null };
    });
  return Response.json({ invoices });
}

// Snapshot totals dari Laporan Biaya Admin untuk suatu periode — dibuat sekali, tidak pernah
// dihitung ulang otomatis, supaya rate yang berubah setelahnya atau koreksi data tidak mengubah
// angka yang sudah diinvoice ke client.
export async function POST(req: NextRequest) {
  const guard = requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const data = await req.json() as { from?: string; to?: string; note?: string; dueDate?: string };
  if (!data.from || !data.to) return Response.json({ error: 'Periode (from/to) wajib diisi.' }, { status: 400 });

  const db = getDb();
  const report = await computeReport(db, data.from, data.to);

  const ref = db.collection('adminFeeInvoices').doc();
  const invoiceNo = `INV-ADM-${ref.id.slice(0, 8).toUpperCase()}`;
  await ref.set({
    invoiceNo,
    periodFrom: report.from,
    periodTo: report.to,
    breakdown: report.breakdown,
    transactionIds: collectTransactionIds(report),
    totalRevenue: report.totalRevenue,
    totalFee: report.totalFee,
    status: 'draft',
    // Catatan bebas dari superadmin untuk invoice ini (mis. penjelasan penyesuaian rate,
    // permintaan khusus) — ikut tampil di halaman Tagihan admin & di PDF, bukan cuma internal.
    note: data.note?.trim() || null,
    dueDate: data.dueDate || null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: guard.username,
  });

  return Response.json({ id: ref.id, invoiceNo });
}
