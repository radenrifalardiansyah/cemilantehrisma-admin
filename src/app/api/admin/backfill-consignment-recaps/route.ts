import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/rbac';
import type { Timestamp } from 'firebase-admin/firestore';

// Backfill sekali-pakai (Tahap 13 migrasi Fase 2, lihat plan gleaming-wondering-quokka.md):
// salin dokumen `consignmentRecaps` Firestore ke tabel Postgres `consignment_recaps`, idempotent
// (skip id yang sudah ada, sama pola dengan /api/admin/backfill-orders) — aman dipanggil berulang
// untuk menangkap rekap baru yang masuk di antara backfill dan deploy cutover. Dipaginasi lewat
// `__name__` (bukan `createdAt`, supaya tidak butuh index tambahan dan tidak masalah kalau ada
// dokumen tanpa createdAt).
const BATCH_SIZE = 300;

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && typeof (v as Timestamp).toDate === 'function') return (v as Timestamp).toDate();
  return new Date();
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;

  const db = getDb();
  const sql = getSql();
  const { searchParams } = new URL(req.url);
  const cursorId = searchParams.get('after');

  let query = db.collection('consignmentRecaps').orderBy('__name__').limit(BATCH_SIZE);
  if (cursorId) {
    const cursorDoc = await db.collection('consignmentRecaps').doc(cursorId).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }
  const snap = await query.get();

  let migrated = 0, skipped = 0;
  for (const doc of snap.docs) {
    const [{ exists }] = await sql<{ exists: boolean }[]>`select exists(select 1 from consignment_recaps where id = ${doc.id})`;
    if (exists) { skipped++; continue; }

    const data = doc.data() as Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items : [];
    // Rekap lama (sebelum field `paymentStatus` ada) tidak punya field ini sama sekali di
    // Firestore — kode pembaca di seluruh app (laporan, admin-fee, wallet balance) mengecek
    // `paymentStatus !== 'belum_lunas'` untuk "dihitung sebagai omzet", dan
    // `undefined !== 'belum_lunas'` bernilai true — jadi field yang absen SUDAH terhitung
    // lunas di kode lama. Default ke 'belum_lunas' di sini akan membalik makna itu (rekap lama
    // jadi TIDAK terhitung omzet) — makanya default-nya 'lunas', persis pola yang sama dengan
    // backfill-orders untuk bug yang sama.
    const paymentStatus = (data.paymentStatus as string) ?? 'lunas';

    await sql`
      insert into consignment_recaps (
        id, location_id, location_name, items, total_sold, total_retur, total_reject, total_revenue,
        payment_status, warehouse_id, warehouse_name, note, wallet_id, due_date, overdue_notified_at,
        created_at, updated_at
      ) values (
        ${doc.id}, ${(data.locationId as string) ?? ''}, ${(data.locationName as string) ?? ''},
        ${JSON.stringify(items)}, ${Number(data.totalSold) || 0}, ${Number(data.totalRetur) || 0},
        ${Number(data.totalReject) || 0}, ${Number(data.totalRevenue) || 0}, ${paymentStatus},
        ${(data.warehouseId as string) ?? null}, ${(data.warehouseName as string) ?? null},
        ${(data.note as string) ?? null}, ${(data.walletId as string) ?? null},
        ${data.dueDate ? toDate(data.dueDate) : null}, ${data.overdueNotifiedAt ? toDate(data.overdueNotifiedAt) : null},
        ${toDate(data.createdAt)}, ${data.updatedAt ? toDate(data.updatedAt) : null}
      )
    `;
    migrated++;
  }

  const last = snap.docs[snap.docs.length - 1];
  return Response.json({
    migrated, skipped, processed: snap.docs.length,
    nextCursor: last ? last.id : null,
    done: snap.docs.length < BATCH_SIZE,
  });
}
