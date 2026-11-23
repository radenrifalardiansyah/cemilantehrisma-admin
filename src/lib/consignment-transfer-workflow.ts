import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/db-retry';
import type { AuthUser } from '@/lib/admin-auth';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { revalidateProductStock } from '@/lib/revalidate';
import { wibDateKey } from '@/lib/date';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { rowToTransfer, TRANSFERS_LIST_TAG, CONSIGNMENT_ANALYTICS_TAG, type ConsignmentTransferRow, type ConsignmentTransfer } from '@/lib/consignment-transfers-pg';
import {
  TransferActionError, transferActionBlockedReason, normalizeTransferStatus,
  invalidTransferItemsMessage, mergeTransferItems, type TransferItemInput,
} from '@/lib/consignment-transfer-status';
import { applyTransferEffect, reverseTransferEffect } from '@/lib/consignment-transfer-effect';

// Approve / tolak / batal / buat / edit / hapus Transfer Stok Antar Mitra. Semua logika bisnis di sini; route tipis.

export { TransferActionError };

export { TRANSFERS_LIST_TAG, CONSIGNMENT_ANALYTICS_TAG };

// Error tak terduga (DB/bug) tidak dikirim mentah ke klien: log detail di server, klien dapat pesan generik 500.
function unexpected(err: unknown, context: string, message: string): TransferActionError {
  console.error(context, err);
  return new TransferActionError(message, 500);
}

export function revalidateTransferCaches(opts: { stock?: boolean; effect?: boolean } = {}) {
  revalidateTag(TRANSFERS_LIST_TAG, { expire: 0 });
  // Approve/batal mengubah stok mitra → laporan & analitik ikut. (Laporan harian tidak ter-cache.)
  if (opts.effect) revalidateTag(CONSIGNMENT_ANALYTICS_TAG, { expire: 0 });
  if (opts.stock) revalidateProductStock();
}

interface LocationLite { id: string; name: string; is_active: boolean | null }

// Dua mitra harus ada dan aktif. Mengembalikan namanya (snapshot untuk dokumen).
type Query = ReturnType<typeof getSql>;
async function loadActiveLocations(q: Query, fromId: string, toId: string): Promise<{ fromName: string; toName: string }> {
  const rows = await q<LocationLite[]>`select id, name, is_active from consignment_locations where id in (${fromId}, ${toId})`;
  const from = rows.find(r => r.id === fromId);
  const to = rows.find(r => r.id === toId);
  if (!from) throw new TransferActionError('Mitra asal tidak ditemukan.');
  if (!to) throw new TransferActionError('Mitra tujuan tidak ditemukan.');
  if (from.is_active === false) throw new TransferActionError(`Mitra asal "${from.name}" nonaktif.`);
  if (to.is_active === false) throw new TransferActionError(`Mitra tujuan "${to.name}" nonaktif.`);
  return { fromName: from.name, toName: to.name };
}

export interface TransferBody {
  fromLocationId?: unknown; toLocationId?: unknown; items?: unknown; note?: unknown; date?: unknown;
}
export interface ValidatedTransfer {
  fromLocationId: string; toLocationId: string; fromLocationName: string; toLocationName: string;
  items: { productId: string; productName: string; qty: number; hargaTitip: number }[];
  note: string; docDate: Date | null;
}

// Validasi body POST/PUT (di luar transaksi; otoritas stok tetap saat approve). Melempar TransferActionError 400.
export async function validateTransferBody(body: TransferBody): Promise<ValidatedTransfer> {
  const fromLocationId = typeof body.fromLocationId === 'string' ? body.fromLocationId : '';
  const toLocationId = typeof body.toLocationId === 'string' ? body.toLocationId : '';
  if (!fromLocationId) throw new TransferActionError('Pilih mitra asal.');
  if (!toLocationId) throw new TransferActionError('Pilih mitra tujuan.');
  if (fromLocationId === toLocationId) throw new TransferActionError('Mitra asal dan tujuan tidak boleh sama.');
  const itemsError = invalidTransferItemsMessage(body.items);
  if (itemsError) throw new TransferActionError(itemsError);
  const merged = mergeTransferItems(body.items as TransferItemInput[]);
  let docDate: Date | null = null;
  if (body.date !== undefined && body.date !== null && body.date !== '') {
    docDate = new Date(body.date as string);
    if (typeof body.date !== 'string' || Number.isNaN(docDate.getTime())) throw new TransferActionError('Tanggal dokumen tidak valid.');
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';

  const sql = getSql();
  const { fromName, toName } = await loadActiveLocations(sql, fromLocationId, toLocationId);

  const productIds = merged.map(m => m.productId);
  const [products, stockRows] = await Promise.all([
    sql<{ id: string; name: string }[]>`select id, name from products where id in ${sql(productIds)}`,
    sql<{ product_id: string; stock_qty: string }[]>`select product_id, stock_qty from consignment_stock where location_id = ${fromLocationId} and product_id in ${sql(productIds)}`,
  ]);
  const nameById = new Map(products.map(p => [p.id, p.name]));
  const stockById = new Map(stockRows.map(r => [r.product_id, Number(r.stock_qty) || 0]));
  const problems: string[] = [];
  for (const m of merged) {
    const name = nameById.get(m.productId);
    if (!name) { problems.push(`produk ${m.productId} tidak ditemukan`); continue; }
    const have = stockById.get(m.productId);
    if (have === undefined) problems.push(`${name} (tidak ada stok di ${fromName})`);
    else if (have < m.qty) problems.push(`${name} (stok di ${fromName} ${have}, diminta ${m.qty})`);
  }
  if (problems.length > 0) throw new TransferActionError(`Stok mitra asal tidak cukup: ${problems.join(', ')}`);

  return {
    fromLocationId, toLocationId, fromLocationName: fromName, toLocationName: toName,
    items: merged.map(m => ({ productId: m.productId, productName: nameById.get(m.productId)!, qty: m.qty, hargaTitip: 0 })),
    note, docDate,
  };
}

export async function createTransferDraft(body: TransferBody, actor: AuthUser): Promise<{ id: string; docNumber: string }> {
  const v = await validateTransferBody(body);
  const sql = getSql();
  const db = getDb();
  const id = randomUUID();
  const docDate = v.docDate ?? new Date();
  let docNumber: string;
  try {
    docNumber = await sql.begin(async pgTx => {
      const number = await nextDocNumber(pgTx, 'TMP', periodOf(wibDateKey(docDate)));
      await pgTx`
        insert into consignment_transfers (id, doc_number, from_location_id, to_location_id, from_location_name, to_location_name, items, note, doc_date, status, created_by)
        values (${id}, ${number}, ${v.fromLocationId}, ${v.toLocationId}, ${v.fromLocationName}, ${v.toLocationName}, ${JSON.stringify(v.items)}, ${v.note}, ${docDate}, 'draft', ${actor.username})
      `;
      return number;
    });
  } catch (err) {
    const fk = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503';
    if (fk) throw new TransferActionError('Mitra tidak ditemukan.');
    throw unexpected(err, 'create consignment transfer', 'Gagal menyimpan transfer, coba lagi');
  }
  try {
    await logHistory(db, {
      entity: 'consignment', entityCollection: 'consignmentTransfers', entityId: id,
      entityLabel: `${docNumber} ${v.fromLocationName} → ${v.toLocationName}`,
      action: 'create', actor,
      after: { docNumber, fromLocationId: v.fromLocationId, toLocationId: v.toLocationId, items: v.items, note: v.note, status: 'draft' },
      meta: { status: 'draft' },
    });
  } catch (err) { console.error('Failed to write history for consignment transfer create', err); }
  return { id, docNumber };
}

export async function updateTransferDraft(id: string, body: TransferBody, actor: AuthUser): Promise<void> {
  const v = await validateTransferBody(body);
  const sql = getSql();
  let before: ConsignmentTransfer;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<ConsignmentTransferRow[]>`select * from consignment_transfers where id = ${id} for update`;
      if (!row) throw new TransferActionError('Transfer tidak ditemukan.', 404);
      const t = rowToTransfer(row);
      const blocked = transferActionBlockedReason(t.status, 'edit');
      if (blocked) throw new TransferActionError(blocked, 409);
      await pgTx`
        update consignment_transfers set
          from_location_id = ${v.fromLocationId}, to_location_id = ${v.toLocationId},
          from_location_name = ${v.fromLocationName}, to_location_name = ${v.toLocationName},
          items = ${JSON.stringify(v.items)}, note = ${v.note}, doc_date = ${v.docDate ?? row.doc_date}, updated_at = now()
        where id = ${id}
      `;
      return t;
    });
  } catch (err) {
    if (err instanceof TransferActionError) throw err;
    throw unexpected(err, 'update consignment transfer', 'Gagal mengubah transfer, coba lagi');
  }
  try {
    await logHistory(getDb(), {
      entity: 'consignment', entityCollection: 'consignmentTransfers', entityId: id,
      entityLabel: `${before.docNumber} ${v.fromLocationName} → ${v.toLocationName}`,
      action: 'update', actor, before,
      after: { ...before, fromLocationId: v.fromLocationId, toLocationId: v.toLocationId, items: v.items, note: v.note },
      meta: { status: 'draft' },
    });
  } catch (err) { console.error('Failed to write history for consignment transfer update', err); }
}

// Hapus: hanya draft/ditolak/dibatalkan (tidak pernah ada efek stok yang tersisa). Approved → 409.
export async function deleteTransfer(id: string, actor: AuthUser): Promise<void> {
  const sql = getSql();
  let before: ConsignmentTransfer;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<ConsignmentTransferRow[]>`select * from consignment_transfers where id = ${id} for update`;
      if (!row) throw new TransferActionError('Transfer tidak ditemukan.', 404);
      const t = rowToTransfer(row);
      const blocked = transferActionBlockedReason(t.status, 'delete');
      if (blocked) throw new TransferActionError(blocked, 409);
      await pgTx`delete from consignment_transfers where id = ${id}`;
      return t;
    });
  } catch (err) {
    if (err instanceof TransferActionError) throw err;
    throw unexpected(err, 'delete consignment transfer', 'Gagal menghapus transfer, coba lagi');
  }
  try {
    await logHistory(getDb(), {
      entity: 'consignment', entityCollection: 'consignmentTransfers', entityId: id,
      entityLabel: `${before.docNumber} ${before.fromLocationName} → ${before.toLocationName}`,
      action: 'delete', actor, before, meta: { status: before.status },
    });
  } catch (err) { console.error('Failed to write history for consignment transfer delete', err); }
}

// Approve (draft → approved): SELURUH efek stok terjadi di sini dalam SATU transaksi dengan penguncian baris
// transfer; stok mitra asal divalidasi memakai data saat approve (kurang → ditolak, dokumen tetap draft).
export async function approveTransfer(id: string, actor: AuthUser): Promise<{ id: string; docNumber: string; totalQty: number }> {
  const sql = getSql();
  let before: ConsignmentTransfer;
  try {
    before = await withDeadlockRetry(() => sql.begin(async pgTx => {
      const [row] = await pgTx<ConsignmentTransferRow[]>`select * from consignment_transfers where id = ${id} for update`;
      if (!row) throw new TransferActionError('Transfer tidak ditemukan.', 404);
      const t = rowToTransfer(row);
      const blocked = transferActionBlockedReason(t.status, 'approve');
      if (blocked) throw new TransferActionError(blocked, 409);
      await loadActiveLocations(pgTx as unknown as Query, t.fromLocationId, t.toLocationId);
      const snapshot = await applyTransferEffect(pgTx, {
        id, fromLocationId: t.fromLocationId, fromLocationName: t.fromLocationName,
        toLocationId: t.toLocationId, toLocationName: t.toLocationName, items: t.items,
      });
      await pgTx`
        update consignment_transfers set status = 'approved', items = ${JSON.stringify(snapshot)}, approved_by = ${actor.username}, approved_at = now(), updated_at = now()
        where id = ${id}
      `;
      return { ...t, items: snapshot };
    }));
  } catch (err) {
    if (err instanceof TransferActionError) throw err;
    throw unexpected(err, 'approve consignment transfer', 'Gagal approve, coba lagi');
  }
  const totalQty = before.items.reduce((s, it) => s + it.qty, 0);
  await runEffects('approve', before, actor, `${totalQty} pcs dipindah dari ${before.fromLocationName} ke ${before.toLocationName} (${before.docNumber}) — oleh ${actor.username}.`, 'Transfer stok mitra');
  return { id, docNumber: before.docNumber, totalQty };
}

// Cancel (approved → dibatalkan): balik efek stok; ditolak (dokumen tetap approved) bila stok mitra tujuan kurang.
export async function cancelTransfer(id: string, actor: AuthUser): Promise<void> {
  const sql = getSql();
  let before: ConsignmentTransfer;
  try {
    before = await withDeadlockRetry(() => sql.begin(async pgTx => {
      const [row] = await pgTx<ConsignmentTransferRow[]>`select * from consignment_transfers where id = ${id} for update`;
      if (!row) throw new TransferActionError('Transfer tidak ditemukan.', 404);
      const t = rowToTransfer(row);
      const blocked = transferActionBlockedReason(t.status, 'cancel');
      if (blocked) throw new TransferActionError(blocked, 409);
      await reverseTransferEffect(pgTx, {
        id, fromLocationId: t.fromLocationId, fromLocationName: t.fromLocationName,
        toLocationId: t.toLocationId, toLocationName: t.toLocationName, items: t.items,
      });
      await pgTx`
        update consignment_transfers set status = 'dibatalkan', cancelled_by = ${actor.username}, cancelled_at = now(), updated_at = now()
        where id = ${id}
      `;
      return t;
    }));
  } catch (err) {
    if (err instanceof TransferActionError) throw err;
    throw unexpected(err, 'cancel consignment transfer', 'Gagal membatalkan, coba lagi');
  }
  const totalQty = before.items.reduce((s, it) => s + it.qty, 0);
  await runEffects('cancel', before, actor, `Transfer ${before.docNumber} dibatalkan: ${totalQty} pcs kembali dari ${before.toLocationName} ke ${before.fromLocationName} — oleh ${actor.username}.`, 'Transfer stok mitra dibatalkan');
}

export async function rejectTransfer(id: string, actor: AuthUser, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length > 500) throw new TransferActionError('Alasan penolakan maksimal 500 karakter.');
  const sql = getSql();
  let before: ConsignmentTransfer;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<ConsignmentTransferRow[]>`select * from consignment_transfers where id = ${id} for update`;
      if (!row) throw new TransferActionError('Transfer tidak ditemukan.', 404);
      const t = rowToTransfer(row);
      const blocked = transferActionBlockedReason(normalizeTransferStatus(t.status), 'reject');
      if (blocked) throw new TransferActionError(blocked, 409);
      await pgTx`
        update consignment_transfers set status = 'ditolak', rejected_by = ${actor.username}, rejected_at = now(), reject_reason = ${trimmed || null}, updated_at = now()
        where id = ${id}
      `;
      return t;
    });
  } catch (err) {
    if (err instanceof TransferActionError) throw err;
    throw unexpected(err, 'reject consignment transfer', 'Gagal menolak, coba lagi');
  }
  try {
    await logHistory(getDb(), {
      entity: 'consignment', entityCollection: 'consignmentTransfers', entityId: id,
      entityLabel: `${before.docNumber} - ditolak`, action: 'update', actor,
      before, after: { ...before, status: 'ditolak', rejectedBy: actor.username, rejectReason: trimmed || null },
      meta: { transition: 'reject' },
    });
  } catch (err) { console.error('Failed to write history for consignment transfer reject', err); }
}

// Riwayat + notifikasi pasca-commit (approve/cancel). Best-effort, tidak pernah melempar; saling bebas → paralel.
async function runEffects(kind: 'approve' | 'cancel', t: ConsignmentTransfer, actor: AuthUser, message: string, title: string) {
  const db = getDb();
  const status = kind === 'approve' ? 'approved' : 'dibatalkan';
  await Promise.allSettled([
    (async () => {
      try {
        await logHistory(db, {
          entity: 'consignment', entityCollection: 'consignmentTransfers', entityId: t.id,
          entityLabel: `${t.docNumber} - ${status}`, action: 'update', actor,
          before: { ...t, status: kind === 'approve' ? 'draft' : 'approved' }, after: { ...t, status },
          meta: { transition: kind },
        });
      } catch (err) { console.error(`Failed to write history for consignment transfer ${kind}`, err); }
    })(),
    (async () => {
      try {
        await notify(db, {
          type: 'consignment_send', title, message, link: 'consignment',
          entityCollection: 'consignmentTransfers', entityId: t.id, actor,
        });
      } catch (err) { console.error(`Failed to send notification for consignment transfer ${kind}`, err); }
    })(),
  ]);
}
