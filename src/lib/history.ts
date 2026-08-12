import { FieldValue, Firestore, Transaction, DocumentData } from 'firebase-admin/firestore';
import type { AuthUser } from '@/lib/admin-auth';

// Audit trail generik lintas entitas — mencatat siapa membuat/mengubah/menghapus data transaksi
// apa dan kapan, disimpan di koleksi `audit_log`. Mengikuti konvensi `writeStockLedgerEntry`
// (lihat src/lib/stock.ts): dipanggil di dalam transaksi milik caller, tepat setelah
// tx.set/update/delete pada dokumen bisnisnya, supaya penulisan log atomik dengan mutasinya.

export type AuditAction = 'create' | 'update' | 'delete';

interface HistoryOpts {
  entity: string;
  entityCollection?: string;
  entityId: string;
  entityLabel: string;
  action: AuditAction;
  actor: AuthUser;
  before?: DocumentData | null;
  after?: DocumentData | null;
  meta?: Record<string, unknown>;
}

// Buang sentinel FieldValue (serverTimestamp(), increment(), dst) yang mungkin ikut terbawa
// kalau snapshot diambil dari payload mentah alih-alih hasil tx.get() — supaya tidak pernah
// tersimpan sebagai objek sentinel yang belum ter-resolve di dalam before/after.
function sanitizeForAudit(data: DocumentData | null | undefined): DocumentData | null {
  if (!data) return null;
  const clean: DocumentData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof FieldValue) continue;
    clean[key] = value;
  }
  return clean;
}

// Diff dangkal (top-level key) antara before/after — cukup untuk menandai field apa saja yang
// berubah di UI riwayat tanpa perlu diff mendalam pada nested object/array.
export function diffFields(before: DocumentData | null, after: DocumentData | null): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  keys.forEach(key => {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  });
  return changed;
}

function buildAuditDoc(opts: HistoryOpts) {
  const before = sanitizeForAudit(opts.before);
  const after = sanitizeForAudit(opts.after);
  return {
    entity: opts.entity,
    entityCollection: opts.entityCollection ?? opts.entity,
    entityId: opts.entityId,
    entityLabel: opts.entityLabel,
    action: opts.action,
    actorUsername: opts.actor.username,
    actorRole: opts.actor.role,
    before,
    after,
    changedFields: opts.action === 'update' ? diffFields(before, after) : null,
    meta: opts.meta ?? {},
    createdAt: FieldValue.serverTimestamp(),
  };
}

// Untuk route yang sudah pakai db.runTransaction — panggil tepat setelah tx.set/update/delete
// pada dokumen bisnisnya, di dalam transaksi yang sama.
export function writeHistoryEntry(tx: Transaction, db: Firestore, opts: HistoryOpts): void {
  tx.set(db.collection('audit_log').doc(), buildAuditDoc(opts));
}

// Untuk route sederhana yang tidak membuka transaksi sendiri (capital, expenses, income,
// warehouses, pos/shifts). Panggil setelah mutasi berhasil, dibungkus try/catch di call site —
// kegagalan menulis audit log tidak boleh menggagalkan mutasi bisnis yang sudah terjadi.
export async function logHistory(db: Firestore, opts: HistoryOpts): Promise<void> {
  await db.collection('audit_log').add(buildAuditDoc(opts));
}
