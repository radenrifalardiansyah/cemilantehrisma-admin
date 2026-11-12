import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { invalidQtyMessage } from '@/lib/validate-items';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { logHistory } from '@/lib/history';
import { rowToShipment, type ShipmentRow } from '@/lib/shipments-pg';
import { normalizeShipmentStatus, type ShipmentStatus } from '@/lib/shipment-status';
import { mergeItems, type SendItemInput } from '@/lib/shipment-items';

// Sama seperti orders/route.ts & consignment/recap/route.ts: dibaca tanpa batas tanggal oleh tab
// Konsinyasi setiap kali dibuka (plus tiap tampilan laporan berperiode). TTL pendek (15s, sama
// seperti orders) menjaga tampilan tetap terasa langsung sambil menyerap lonjakan baca yang
// terjadi bersamaan. (Tahap 18a migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md.)
const getCachedShipments = unstable_cache(
  async (from: string | null, to: string | null, limit: number, status: ShipmentStatus | null) => {
    const sql = getSql();
    // Fragmen filter status opsional — tanpa status mengembalikan SEMUA status (UI menampilkan badge).
    const statusFilter = status ? sql`and status = ${status}` : sql``;
    let rows: ShipmentRow[];
    if (from && to) {
      rows = await sql<ShipmentRow[]>`select * from consignment_shipments where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()} ${statusFilter} order by created_at desc`;
    } else if (from) {
      rows = await sql<ShipmentRow[]>`select * from consignment_shipments where created_at >= ${wibDayStart(from).toDate()} ${statusFilter} order by created_at desc`;
    } else if (to) {
      rows = await sql<ShipmentRow[]>`select * from consignment_shipments where created_at <= ${wibDayEnd(to).toDate()} ${statusFilter} order by created_at desc`;
    } else {
      rows = await sql<ShipmentRow[]>`select * from consignment_shipments where true ${statusFilter} order by created_at desc limit ${limit}`;
    }
    return rows.map(rowToShipment);
  },
  ['admin-consignment-shipments-list'],
  { revalidate: 15, tags: ['admin-consignment-shipments-list'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai filter periode di tab Lokasi/Laporan
  const to   = searchParams.get('to');
  const limit = parseInt(searchParams.get('limit') ?? '50');
  // ?status=draft|approved|ditolak (opsional). Nilai tak dikenal diabaikan = semua status.
  const statusParam = searchParams.get('status');
  const status = statusParam && ['draft', 'approved', 'ditolak'].includes(statusParam) ? normalizeShipmentStatus(statusParam) : null;

  const shipments = await getCachedShipments(from, to, limit, status);
  return Response.json({ shipments });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    locationId: string; locationName: string; warehouseId: string; warehouseName?: string;
    note?: string; items: SendItemInput[]; date?: string;
  };
  const qtyError = invalidQtyMessage(data.items);
  if (qtyError) return Response.json({ error: qtyError }, { status: 400 });
  const items = mergeItems(data.items ?? []);
  if (items.length === 0) return Response.json({ error: 'Minimal 1 produk dikirim.' }, { status: 400 });
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang asal pengiriman.' }, { status: 400 });
  if (!data.locationId) return Response.json({ error: 'Pilih lokasi tujuan pengiriman.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const shipmentId = randomUUID();
  const itemsWithSubtotal = items.map(it => ({ ...it, subtotal: it.qty * it.hargaTitip }));
  const createdAt = data.date ? new Date(data.date) : new Date();

  // Pengiriman baru selalu berstatus DRAFT: hanya dokumen — TIDAK ada efek stok (toko/gudang/titip),
  // ledger, notifikasi, atau laporan. Stok divalidasi & dipindahkan saat di-approve
  // (POST /api/consignment/send/[id]/approve). Status ditulis eksplisit; default kolom di DB tetap
  // 'approved' supaya baris/kode lama aman.
  try {
    await sql`
      insert into consignment_shipments (id, location_id, location_name, warehouse_id, warehouse_name, items, note, created_at, status, created_by)
      values (${shipmentId}, ${data.locationId}, ${data.locationName}, ${data.warehouseId}, ${data.warehouseName ?? ''}, ${JSON.stringify(itemsWithSubtotal)}, ${data.note ?? ''}, ${createdAt}, 'draft', ${guard.username})
    `;
  } catch (err) {
    // FK location/warehouse (23503) = id tidak ada.
    const fk = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503';
    return Response.json({ error: fk ? 'Lokasi atau gudang tidak ditemukan.' : err instanceof Error ? err.message : 'Gagal menyimpan pengiriman.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentShipments',
      entityId: shipmentId,
      entityLabel: `${data.locationName ?? 'Kirim Konsinyasi'}${data.date ? ` - ${data.date}` : ''}`,
      action: 'create',
      actor: guard,
      after: {
        locationId: data.locationId, locationName: data.locationName,
        warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
        items: itemsWithSubtotal, note: data.note ?? '', status: 'draft',
      },
      meta: { status: 'draft' },
    });
  } catch (err) {
    console.error('Failed to write history for consignment send create', err);
  }

  revalidateTag('admin-consignment-shipments-list', { expire: 0 });
  return Response.json({ id: shipmentId, status: 'draft' });
}
