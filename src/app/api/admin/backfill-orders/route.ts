import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/rbac';
import type { Timestamp } from 'firebase-admin/firestore';

// Backfill sekali-pakai (Tahap 12 migrasi Fase 2, lihat plan gleaming-wondering-quokka.md):
// salin dokumen `orders` Firestore ke tabel Postgres `orders`, idempotent (skip id yang sudah
// ada, sama pola dengan /api/seed) — aman dipanggil berulang untuk menangkap order baru yang
// masuk di antara backfill dan deploy cutover. Dipaginasi lewat `__name__` (bukan `createdAt`,
// supaya tidak butuh index tambahan dan tidak masalah kalau ada dokumen tanpa createdAt).
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

  let query = db.collection('orders').orderBy('__name__').limit(BATCH_SIZE);
  if (cursorId) {
    const cursorDoc = await db.collection('orders').doc(cursorId).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }
  const snap = await query.get();

  let migrated = 0, skipped = 0;
  for (const doc of snap.docs) {
    const [{ exists }] = await sql<{ exists: boolean }[]>`select exists(select 1 from orders where id = ${doc.id})`;
    if (exists) { skipped++; continue; }

    const data = doc.data() as Record<string, unknown>;
    // Bug lama: kasir menulis status 'done' untuk pesanan selesai, tapi semua pembaca lain
    // (badge, laporan, admin-fee, wallet balance) mengecek 'selesai' — dinormalisasi di sini.
    const rawStatus = typeof data.status === 'string' ? data.status : 'baru';
    const status = rawStatus === 'done' ? 'selesai' : rawStatus;
    const items = Array.isArray(data.items) ? data.items : [];
    const discount = data.discount ?? null;
    const source = (data.source as string) ?? 'kasir';
    // Order kasir lama (sebelum field `stockCut` ada) tidak punya field ini sama sekali di
    // Firestore — beda dari eksplisit `false` (order kasir yang sengaja belum dipotong, mis.
    // "Buka PO"). Absen + source kasir = stoknya SUDAH dipotong (perilaku lama sebelum ada
    // konsep PO), resolusi ini sama seperti fallback di src/lib/order-stock-pg.ts.
    const stockCut = data.stockCut === true || (data.stockCut === undefined && source === 'kasir');
    // Order lama (sebelum field `paymentStatus` ada, dulu cuma dipakai online/transfer) tidak
    // punya field ini sama sekali di Firestore — kode pembaca di seluruh app (badge, laporan,
    // admin-fee, wallet balance) mengecek `paymentStatus !== 'belum_lunas'` untuk "dihitung
    // sebagai omzet", dan `undefined !== 'belum_lunas'` bernilai true — jadi field yang absen
    // SUDAH terhitung lunas di kode lama. Default ke 'belum_lunas' di sini akan membalik makna
    // itu (order lama jadi TIDAK terhitung omzet) — makanya default-nya 'lunas', bukan
    // 'belum_lunas', supaya perilaku "terhitung omzet" persis sama dengan sebelum migrasi.
    const paymentStatus = (data.paymentStatus as string) ?? 'lunas';

    await sql`
      insert into orders (
        id, invoice_no, date, customer_name, customer_phone, customer_id, items, subtotal, discount, total,
        pdf_url, status, source, delivery_method, address, note, payment_method, payment_status,
        amount_paid, change_amount, transfer_bank, transfer_amount, transfer_proof_url,
        stock_cut, stock_restored, warehouse_id, warehouse_name, wallet_id, shift_id, created_at, updated_at
      ) values (
        ${doc.id}, ${(data.invoiceNo as string) ?? null}, ${(data.date as string) ?? null},
        ${(data.customerName as string) ?? ''}, ${(data.customerPhone as string) ?? null}, ${(data.customerId as string) ?? null},
        ${JSON.stringify(items)}, ${Number(data.subtotal) || 0}, ${discount ? JSON.stringify(discount) : null}, ${Number(data.total) || 0},
        ${(data.pdfUrl as string) ?? null}, ${status}, ${source},
        ${(data.deliveryMethod as string) ?? null}, ${(data.address as string) ?? null}, ${(data.note as string) ?? null},
        ${(data.paymentMethod as string) ?? null}, ${paymentStatus},
        ${data.amountPaid != null ? Number(data.amountPaid) : null}, ${data.changeAmount != null ? Number(data.changeAmount) : null},
        ${(data.transferBank as string) ?? null}, ${data.transferAmount != null ? Number(data.transferAmount) : null}, ${(data.transferProofUrl as string) ?? null},
        ${stockCut}, ${data.stockRestored === true},
        ${(data.warehouseId as string) ?? null}, ${(data.warehouseName as string) ?? null},
        ${(data.walletId as string) ?? null}, ${(data.shiftId as string) ?? null},
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
