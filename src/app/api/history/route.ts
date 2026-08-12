import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { Query, DocumentData } from 'firebase-admin/firestore';
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

function entrySeconds(entry: DocumentData) {
  const ts = entry.createdAt as { seconds?: number; _seconds?: number } | undefined;
  return ts?.seconds ?? ts?._seconds ?? 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entity   = searchParams.get('entity');
  const entityId = searchParams.get('entityId');

  // Mode 1: riwayat satu record spesifik — dipakai oleh tombol "Riwayat" per baris di masing-masing menu.
  if (entityId) {
    if (!entity) return Response.json({ error: 'Parameter entity wajib diisi.' }, { status: 400 });
    const featureKey = ENTITY_FEATURE_KEY[entity] ?? 'history';
    const guard = await requirePermission(req, featureKey, 'view');
    if (guard instanceof Response) return guard;
    const snap = await getDb().collection('audit_log')
      .where('entity', '==', entity).where('entityId', '==', entityId).get();
    const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => entrySeconds(b) - entrySeconds(a));
    return Response.json({ entries });
  }

  // Mode 2: jelajah lintas-modul (halaman Riwayat) — hanya satu equality filter (`entity`) selain
  // rentang tanggal, supaya tidak perlu composite index untuk tiap kombinasi filter. Filter
  // `actorUsername`/`action` diterapkan client-side di atas batch yang sudah difetch.
  const guard = await requirePermission(req, 'history', 'view');
  if (guard instanceof Response) return guard;
  const from = searchParams.get('from'); // ISO yyyy-mm-dd
  const to   = searchParams.get('to');

  let query: Query<DocumentData> = getDb().collection('audit_log').orderBy('createdAt', 'desc');
  if (entity) query = query.where('entity', '==', entity);
  if (from)   query = query.where('createdAt', '>=', wibDayStart(from));
  if (to)     query = query.where('createdAt', '<=', wibDayEnd(to));
  if (!from && !to) query = query.limit(300);

  const snap = await query.get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ entries });
}
