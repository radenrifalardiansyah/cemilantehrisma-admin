import { randomUUID } from 'crypto';
import { after } from 'next/server';
import { FieldValue, Firestore, Transaction, DocumentData } from 'firebase-admin/firestore';
import { getSql } from '@/lib/db';
import type { AuthUser } from '@/lib/admin-auth';

// Audit trail generik lintas entitas — mencatat siapa membuat/mengubah/menghapus data transaksi
// apa dan kapan, disimpan di tabel Postgres `audit_log` (Tahap 15 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md). `tx`/`db` (Firestore) dipertahankan di kedua signature di bawah
// untuk kompatibilitas ~90 titik panggil yang sudah ada — sejak migrasi ini keduanya tidak lagi
// dipakai untuk menyimpan apa pun, cuma parameter kosong yang diabaikan.

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

interface AuditDoc {
  entity: string; entityCollection: string; entityId: string; entityLabel: string;
  action: AuditAction; actorUsername: string; actorRole: string;
  before: DocumentData | null; after: DocumentData | null;
  changedFields: string[] | null; meta: Record<string, unknown>;
}

function buildAuditDoc(opts: HistoryOpts): AuditDoc {
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
  };
}

async function insertAuditLog(doc: AuditDoc): Promise<void> {
  const sql = getSql();
  await sql`
    insert into audit_log (
      id, entity, entity_collection, entity_id, entity_label, action, actor_username, actor_role,
      before, after, changed_fields, meta, created_at
    ) values (
      ${randomUUID()}, ${doc.entity}, ${doc.entityCollection}, ${doc.entityId}, ${doc.entityLabel}, ${doc.action},
      ${doc.actorUsername}, ${doc.actorRole}, ${JSON.stringify(doc.before)}, ${JSON.stringify(doc.after)},
      ${JSON.stringify(doc.changedFields)}, ${JSON.stringify(doc.meta)}, now()
    )
  `;
}

// Untuk route yang sudah pakai db.runTransaction — dipanggil tepat setelah tx.set/update/delete
// pada dokumen bisnisnya, DI DALAM transaksi Firestore yang sama. `tx`/`db` diabaikan (sisi
// bisnis banyak yang sudah bukan Firestore lagi juga); penulisan audit dijadwalkan lewat
// `after()` supaya tetap "fire and forget" seperti semula (signature ini tetap `void`, ~90 titik
// panggil tidak butuh berubah jadi `await`), dijalankan setelah response terkirim tapi sebelum
// fungsi request benar-benar berhenti. Catatan: kalau transaksi Firestore pembungkusnya retry
// (konflik), `after()` bisa terpanggil lebih dari sekali — audit log best-effort, entri dobel
// sesekali dianggap trade-off yang bisa diterima (lihat komentar sama di logHistory di bawah).
export function writeHistoryEntry(tx: Transaction, db: Firestore, opts: HistoryOpts): void {
  void tx; void db;
  const doc = buildAuditDoc(opts);
  after(() => insertAuditLog(doc).catch(err => console.error('Failed to write audit log', err)));
}

// Untuk route sederhana yang tidak membuka transaksi sendiri (capital, expenses, income,
// warehouses, pos/shifts). Panggil setelah mutasi berhasil, dibungkus try/catch di call site —
// kegagalan menulis audit log tidak boleh menggagalkan mutasi bisnis yang sudah terjadi.
export async function logHistory(db: Firestore, opts: HistoryOpts): Promise<void> {
  void db;
  await insertAuditLog(buildAuditDoc(opts));
}
