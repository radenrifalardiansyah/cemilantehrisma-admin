import { NextRequest } from 'next/server';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';

// Riwayat satu record spesifik (dipakai tombol "Riwayat" di tiap baris menu transaksi) digerbangi
// oleh permission modul aslinya, bukan permission 'history' — supaya siapa pun yang sudah boleh
// melihat pesanan/produksi/dst juga otomatis boleh melihat riwayat record itu sendiri, tanpa perlu
// izin 'history' terpisah. Izin 'history' tetap dipakai untuk mode jelajah lintas-modul (halaman Riwayat).
const ENTITY_FEATURE_KEY: Record<string, string> = {
  orders: 'orders', production: 'production', 'material-purchases': 'materials',
  materials: 'materials', consignment: 'consignment', stock: 'stock',
  warehouses: 'settings', pos: 'pos', capital: 'capital', income: 'income', expenses: 'expenses',
};

interface AuditRow {
  id: string; entity: string; entity_collection: string | null; entity_id: string; entity_label: string;
  action: string; actor_username: string; actor_role: string;
  before: unknown; after: unknown; changed_fields: unknown; meta: unknown; created_at: Date;
}
function rowToEntry(r: AuditRow) {
  return {
    id: r.id,
    entity: r.entity,
    entityCollection: r.entity_collection,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
    action: r.action,
    actorUsername: r.actor_username,
    actorRole: r.actor_role,
    before: parseJsonb(r.before),
    after: parseJsonb(r.after),
    changedFields: parseJsonb(r.changed_fields),
    meta: parseJsonb(r.meta) ?? {},
    createdAt: { seconds: Math.floor(r.created_at.getTime() / 1000), nanoseconds: 0 },
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entity   = searchParams.get('entity');
  const entityId = searchParams.get('entityId');
  const sql = getSql();

  // Mode 1: riwayat satu record spesifik — dipakai oleh tombol "Riwayat" per baris di masing-masing menu.
  if (entityId) {
    if (!entity) return Response.json({ error: 'Parameter entity wajib diisi.' }, { status: 400 });
    const featureKey = ENTITY_FEATURE_KEY[entity] ?? 'history';
    const guard = await requirePermission(req, featureKey, 'view');
    if (guard instanceof Response) return guard;
    const rows = await sql<AuditRow[]>`
      select * from audit_log where entity = ${entity} and entity_id = ${entityId} order by created_at desc
    `;
    return Response.json({ entries: rows.map(rowToEntry) });
  }

  // Mode 2: jelajah lintas-modul (halaman Riwayat).
  const guard = await requirePermission(req, 'history', 'view');
  if (guard instanceof Response) return guard;
  const from = searchParams.get('from'); // ISO yyyy-mm-dd
  const to   = searchParams.get('to');

  let rows: AuditRow[];
  if (entity && from && to) {
    rows = await sql<AuditRow[]>`select * from audit_log where entity = ${entity} and created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
  } else if (entity && from) {
    rows = await sql<AuditRow[]>`select * from audit_log where entity = ${entity} and created_at >= ${wibDayStart(from).toDate()} order by created_at desc`;
  } else if (entity && to) {
    rows = await sql<AuditRow[]>`select * from audit_log where entity = ${entity} and created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
  } else if (entity) {
    rows = await sql<AuditRow[]>`select * from audit_log where entity = ${entity} order by created_at desc limit 300`;
  } else if (from && to) {
    rows = await sql<AuditRow[]>`select * from audit_log where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
  } else if (from) {
    rows = await sql<AuditRow[]>`select * from audit_log where created_at >= ${wibDayStart(from).toDate()} order by created_at desc`;
  } else if (to) {
    rows = await sql<AuditRow[]>`select * from audit_log where created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
  } else {
    rows = await sql<AuditRow[]>`select * from audit_log order by created_at desc limit 300`;
  }

  return Response.json({ entries: rows.map(rowToEntry) });
}
