import { revalidateTag } from 'next/cache';
import { after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/db-retry';
import type { AuthUser } from '@/lib/admin-auth';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { revalidateProductStock } from '@/lib/revalidate';
import { notifyProductLowStock } from '@/lib/low-stock';
import { shipmentPdfTag } from '@/lib/pdf/shipmentPdfTag';
import { rowToShipment, type ShipmentRow } from '@/lib/shipments-pg';
import { shipmentActionBlockedReason, normalizeShipmentStatus, ShipmentActionError } from '@/lib/shipment-status';
import { applyShipmentEffect, shipmentStockDeltas } from '@/lib/shipment-effect';

// Approve / tolak Kirim Stok (draft → approved | ditolak). Dipakai endpoint satuan & bulk-approve.

export const SHIPMENTS_LIST_TAG = 'admin-consignment-shipments-list';

export { ShipmentActionError };

// Error tak terduga (DB/bug) tidak dikirim mentah ke klien: log detail di server, klien dapat pesan generik 500.
function unexpectedShipmentError(err: unknown, context: string, message: string): ShipmentActionError {
  console.error(context, err);
  return new ShipmentActionError(message, 500);
}

export function revalidateShipmentCaches(ids: string[], opts: { stock?: boolean } = {}) {
  // expire: 0 (bukan 'max' = stale-while-revalidate): link nota publik yang sempat 404 saat masih draft
  // harus langsung terbuka setelah approve, tidak menyajikan hasil basi dulu.
  for (const id of ids) revalidateTag(shipmentPdfTag(id), { expire: 0 });
  revalidateTag(SHIPMENTS_LIST_TAG, { expire: 0 });
  if (opts.stock) revalidateProductStock();
}

export interface ApprovedShipment { id: string; locationName: string; totalQty: number }
export interface ApproveOutcome extends ApprovedShipment {
  /** Efek samping non-DB pasca-commit (riwayat, notifikasi, low-stock). Best-effort: tidak pernah melempar. */
  runEffects: () => Promise<void>;
}

// Fase DB approve: SELURUH efek stok (kurangi toko+gudang, ledger, tambah stok titip) terjadi di sini, dalam
// SATU transaksi dengan penguncian baris shipment; stok divalidasi memakai data saat approve (kurang →
// ditolak dengan pesan jelas, shipment tetap draft). Efek samping non-DB TIDAK dijalankan di sini: pemanggil
// menjalankan `runEffects` (langsung atau lewat scheduleApproveEffects/after()). Pemanggil juga
// bertanggung jawab revalidateShipmentCaches.
export async function approveShipmentDb(id: string, actor: AuthUser): Promise<ApproveOutcome> {
  const sql = getSql();
  const db = getDb();
  let before: ReturnType<typeof rowToShipment>;
  let stockAfter: Map<string, number>;
  try {
    ({ before, stockAfter } = await withDeadlockRetry(() => sql.begin(async pgTx => {
      const [row] = await pgTx<ShipmentRow[]>`select * from consignment_shipments where id = ${id} for update`;
      if (!row) throw new ShipmentActionError('Riwayat kirim tidak ditemukan.', 404);
      const s = rowToShipment(row);
      const blocked = shipmentActionBlockedReason(s.status, 'approve');
      if (blocked) throw new ShipmentActionError(blocked, 409);
      if (!s.locationId) throw new ShipmentActionError('Lokasi pengiriman tidak valid.');

      const stockAfter = await applyShipmentEffect(pgTx, {
        locationId: s.locationId, locationName: s.locationName ?? '',
        warehouseId: s.warehouseId, warehouseName: s.warehouseName, note: s.note, items: s.items,
      });
      await pgTx`
        update consignment_shipments set status = 'approved', approved_by = ${actor.username}, approved_at = now(), updated_at = now()
        where id = ${id}
      `;
      return { before: s, stockAfter };
    })));
  } catch (err) {
    if (err instanceof ShipmentActionError) throw err;
    throw unexpectedShipmentError(err, 'approve consignment send', 'Gagal approve, coba lagi');
  }

  const locationName = before.locationName ?? '';
  const totalQty = before.items.reduce((sum, it) => sum + it.qty, 0);
  // Tiga efek saling bebas → paralel (allSettled; tiap efek menangkap & log errornya sendiri).
  const runEffects = async () => {
    await Promise.allSettled([
      (async () => {
        try {
          await logHistory(db, {
            entity: 'consignment', entityCollection: 'consignmentShipments', entityId: id,
            entityLabel: `${locationName || 'Kirim Konsinyasi'} - approved`,
            action: 'update', actor,
            before, after: { ...before, status: 'approved', approvedBy: actor.username },
            meta: { transition: 'approve' },
          });
        } catch (err) { console.error('Failed to write history for consignment send approve', err); }
      })(),
      (async () => {
        try {
          await notify(db, {
            type: 'consignment_send',
            title: 'Kirim stok konsinyasi',
            message: `${totalQty} pcs dikirim ke ${locationName} — oleh ${actor.username}.`,
            link: 'consignment',
            entityCollection: 'consignmentShipments', entityId: id,
            actor,
          });
        } catch (err) { console.error('Failed to send notification for consignment send approve', err); }
      })(),
      // Stok toko berkurang saat approve — beri tahu kalau produknya jadi menipis. stockAfter dari dalam
      // transaksi: stabil walau efek ini jalan belakangan, setelah approve lain di batch yang sama.
      (async () => {
        try {
          await notifyProductLowStock(db, shipmentStockDeltas(before.items, -1), actor, `kirim konsinyasi ke ${locationName}`, stockAfter);
        } catch (err) { console.error('Failed low-stock notification for consignment send approve', err); }
      })(),
    ]);
  };
  return { id, locationName, totalQty, runEffects };
}

// Approve + efek samping dijalankan (paralel) sebelum return. Untuk pemanggil yang butuh efek selesai.
export async function approveShipment(id: string, actor: AuthUser): Promise<ApprovedShipment> {
  const { runEffects, ...result } = await approveShipmentDb(id, actor);
  await runEffects();
  return result;
}

const EFFECTS_CONCURRENCY = 3;

// Jadwalkan efek samping SETELAH respons terkirim (after(), Route Handler runtime nodejs; di Vercel diperpanjang
// lewat waitUntil dan dibatasi maxDuration fungsi). Antar-shipment dibatasi konkurensi kecil (pool DB max 5).
// Bila after() tidak tersedia (di luar request scope), efek dijalankan inline supaya tidak hilang. Tidak melempar.
export async function scheduleApproveEffects(effects: (() => Promise<void>)[]): Promise<void> {
  if (effects.length === 0) return;
  const job = async () => {
    const queue = [...effects];
    const worker = async () => {
      for (let fx = queue.shift(); fx; fx = queue.shift()) {
        try { await fx(); } catch (err) { console.error('approve consignment send: efek pasca-approve gagal', err); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(EFFECTS_CONCURRENCY, queue.length) }, worker));
  };
  try {
    after(job);
  } catch (err) {
    console.error('after() tidak tersedia, efek pasca-approve dijalankan inline', err);
    await job();
  }
}

export async function rejectShipment(id: string, actor: AuthUser, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new ShipmentActionError('Alasan penolakan wajib diisi.');
  if (trimmed.length > 500) throw new ShipmentActionError('Alasan penolakan maksimal 500 karakter.');
  const sql = getSql();
  let before: ReturnType<typeof rowToShipment>;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<ShipmentRow[]>`select * from consignment_shipments where id = ${id} for update`;
      if (!row) throw new ShipmentActionError('Riwayat kirim tidak ditemukan.', 404);
      const s = rowToShipment(row);
      const blocked = shipmentActionBlockedReason(normalizeShipmentStatus(s.status), 'reject');
      if (blocked) throw new ShipmentActionError(blocked, 409);
      await pgTx`
        update consignment_shipments set status = 'ditolak', rejected_by = ${actor.username}, rejected_at = now(), reject_reason = ${trimmed}, updated_at = now()
        where id = ${id}
      `;
      return s;
    });
  } catch (err) {
    if (err instanceof ShipmentActionError) throw err;
    throw unexpectedShipmentError(err, 'reject consignment send', 'Gagal menolak, coba lagi');
  }
  try {
    await logHistory(getDb(), {
      entity: 'consignment', entityCollection: 'consignmentShipments', entityId: id,
      entityLabel: `${before.locationName || 'Kirim Konsinyasi'} - ditolak`,
      action: 'update', actor,
      before, after: { ...before, status: 'ditolak', rejectedBy: actor.username, rejectReason: trimmed },
      meta: { transition: 'reject' },
    });
  } catch (err) { console.error('Failed to write history for consignment send reject', err); }
}
