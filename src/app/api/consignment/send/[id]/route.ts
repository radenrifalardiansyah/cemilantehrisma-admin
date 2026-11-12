import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/db-retry';
import { requirePermission } from '@/lib/rbac';
import { invalidQtyMessage } from '@/lib/validate-items';
import { logHistory } from '@/lib/history';
import { shipmentPdfTag } from '@/lib/pdf/shipmentPdfTag';
import { revalidateProductStock } from '@/lib/revalidate';
import { rowToShipment, type ShipmentRow } from '@/lib/shipments-pg';
import { shipmentActionBlockedReason, type ShipmentStatus } from '@/lib/shipment-status';
import { applyShipmentEffect, reverseShipmentEffect, lockShipmentRows, stockKeyOf } from '@/lib/shipment-effect';
import { ShipmentActionError } from '@/lib/shipment-workflow';
import { normalizeEditItems, type SendItemInput } from '@/lib/shipment-items';

type Ctx = { params: Promise<{ id: string }> };

// Hapus riwayat kirim, bercabang menurut status:
//  - draft / ditolak : hanya menghapus baris dokumen (tidak pernah ada efek stok, jadi tidak ada yang dibalik).
//  - approved        : mengembalikan stok toko & gudang asal, mengurangi stok titip di lokasi, lalu menghapus
//                      dokumen — semuanya dalam SATU transaksi Postgres. Ditolak jika stok titip sudah
//                      terpakai (terjual/direkap) sehingga tidak cukup untuk dibalik.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [shipmentRow] = await sql<ShipmentRow[]>`select * from consignment_shipments where id = ${id}`;
  if (!shipmentRow) return Response.json({ error: 'Riwayat kirim tidak ditemukan.' }, { status: 404 });
  const shipment = rowToShipment(shipmentRow);

  try {
    await withDeadlockRetry(() => sql.begin(async pgTx => {
      // Kunci baris ini lalu cek ulang — data di atas dibaca DI LUAR transaksi. Tanpa ini, dua request
      // bersamaan (mis. double-klik / retry) sama-sama lolos validasi dan membalik stok yang sama dua kali.
      // updated_at ikut berubah saat approve/tolak, jadi perubahan status juga tertangkap di sini.
      const [locked] = await pgTx<{ updated_at: Date | null }[]>`select updated_at from consignment_shipments where id = ${id} for update`;
      if (!locked) throw new Error('Riwayat kirim sudah dihapus.');
      if ((locked.updated_at?.getTime() ?? null) !== (shipmentRow.updated_at?.getTime() ?? null)) {
        throw new Error('Riwayat kirim baru saja diubah — muat ulang lalu coba lagi.');
      }

      if (shipment.status === 'approved') {
        await reverseShipmentEffect(pgTx, {
          locationId: shipment.locationId ?? '', locationName: shipment.locationName ?? '',
          warehouseId: shipment.warehouseId, warehouseName: shipment.warehouseName, items: shipment.items,
        }, { context: 'delete' });
      }
      await pgTx`delete from consignment_shipments where id = ${id}`;
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat kirim.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentShipments',
      entityId: id,
      entityLabel: shipment.locationName || id,
      action: 'delete',
      actor: guard,
      before: shipmentRow,
      meta: { status: shipment.status },
    });
  } catch (err) {
    console.error('Failed to write history for consignment send delete', err);
  }

  revalidateTag(shipmentPdfTag(id), { expire: 0 });
  revalidateTag('admin-consignment-shipments-list', { expire: 0 });
  if (shipment.status === 'approved') revalidateProductStock();
  return Response.json({ ok: true });
}

// Edit riwayat kirim, bercabang menurut status:
//  - draft    : hanya menulis ulang dokumen (tanpa cek stok/ledger/efek apa pun).
//  - approved : membalik efek stok yang lama, menerapkan efek yang baru, dan menulis ulang dokumen dalam
//               SATU transaksi Postgres. Ditolak jika stok lama sudah terpakai atau stok toko tidak cukup.
//               Log gudang lama dibiarkan sebagai riwayat historis.
//  - ditolak  : ditolak (final).
// Status tidak bisa diubah lewat PUT — gunakan endpoint approve/reject.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    locationId: string; locationName: string; warehouseId: string; warehouseName?: string;
    note?: string; items: SendItemInput[]; date?: string; status?: string;
  };
  const qtyError = invalidQtyMessage(data.items);
  if (qtyError) return Response.json({ error: qtyError }, { status: 400 });
  // Normalisasi sama seperti POST (qty Number, harga dibulatkan, baris ganda digabung) + tolak qty <= 0/NaN.
  const normalized = normalizeEditItems(data.items);
  if ('error' in normalized) return Response.json({ error: normalized.error }, { status: 400 });
  const newItems = normalized.items;
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang asal pengiriman.' }, { status: 400 });
  if (!data.locationId) return Response.json({ error: 'Pilih lokasi tujuan pengiriman.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();

  const [shipmentRow] = await sql<ShipmentRow[]>`select * from consignment_shipments where id = ${id}`;
  if (!shipmentRow) return Response.json({ error: 'Riwayat kirim tidak ditemukan.' }, { status: 404 });
  const oldShipment = rowToShipment(shipmentRow);
  const status: ShipmentStatus = oldShipment.status;
  if (data.status !== undefined && data.status !== status) {
    return Response.json({ error: 'Status tidak bisa diubah lewat edit — gunakan Approve atau Tolak.' }, { status: 400 });
  }
  const blocked = shipmentActionBlockedReason(status, 'edit');
  if (blocked) return Response.json({ error: blocked }, { status: 409 });
  const oldItems = oldShipment.items;

  let itemsWithSubtotal: (SendItemInput & { subtotal: number })[] = [];
  // createdAt cuma ditimpa kalau tanggal baru diberikan, kalau tidak dipertahankan (bukan direset ke waktu edit).
  const newCreatedAt = data.date ? new Date(data.date) : shipmentRow.created_at;

  try {
    await withDeadlockRetry(() => sql.begin(async pgTx => {
      // Kunci baris ini lalu cek ulang — data di atas dibaca DI LUAR transaksi. Tanpa ini, dua request
      // bersamaan (mis. double-klik / retry) sama-sama lolos validasi dan membalik stok yang sama dua kali.
      const [locked] = await pgTx<{ updated_at: Date | null }[]>`select updated_at from consignment_shipments where id = ${id} for update`;
      if (!locked) throw new Error('Riwayat kirim sudah dihapus.');
      if ((locked.updated_at?.getTime() ?? null) !== (shipmentRow.updated_at?.getTime() ?? null)) {
        throw new Error('Riwayat kirim baru saja diubah — muat ulang lalu coba lagi.');
      }

      if (status === 'approved') {
        // Kunci gabungan baris lama+baru sekali di awal (urutan seragam), baru balik & terapkan.
        await lockShipmentRows(pgTx, {
          productIds: [...oldItems, ...newItems].map(it => it.productId),
          warehouseId: [oldShipment.warehouseId, data.warehouseId],
          stockKeys: [
            ...oldItems.map(it => stockKeyOf(oldShipment.locationId ?? '', it.productId)),
            ...newItems.map(it => stockKeyOf(data.locationId, it.productId)),
          ],
        });
        await reverseShipmentEffect(pgTx, {
          locationId: oldShipment.locationId ?? '', locationName: oldShipment.locationName ?? '',
          warehouseId: oldShipment.warehouseId, warehouseName: oldShipment.warehouseName, items: oldItems,
        }, { context: 'edit' });
        await applyShipmentEffect(pgTx, {
          locationId: data.locationId, locationName: data.locationName,
          warehouseId: data.warehouseId, warehouseName: data.warehouseName, note: data.note, items: newItems,
        }, { edited: true });
      }

      itemsWithSubtotal = newItems.map(it => ({ ...it, subtotal: it.qty * it.hargaTitip }));

      await pgTx`
        update consignment_shipments set
          location_id = ${data.locationId}, location_name = ${data.locationName},
          warehouse_id = ${data.warehouseId}, warehouse_name = ${data.warehouseName ?? ''},
          items = ${JSON.stringify(itemsWithSubtotal)}, note = ${data.note ?? ''},
          created_at = ${newCreatedAt}, updated_at = now()
        where id = ${id}
      `;
    }));
  } catch (err) {
    if (err instanceof ShipmentActionError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah pengiriman.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentShipments',
      entityId: id,
      entityLabel: `${data.locationName ?? oldShipment.locationName ?? id}${data.date ? ` - ${data.date}` : ''}`,
      action: 'update',
      actor: guard,
      before: shipmentRow,
      after: {
        locationId: data.locationId, locationName: data.locationName,
        warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
        items: itemsWithSubtotal, note: data.note ?? '', status,
      },
      meta: { status },
    });
  } catch (err) {
    console.error('Failed to write history for consignment send update', err);
  }

  revalidateTag(shipmentPdfTag(id), { expire: 0 });
  revalidateTag('admin-consignment-shipments-list', { expire: 0 });
  if (status === 'approved') revalidateProductStock();
  return Response.json({ ok: true });
}
