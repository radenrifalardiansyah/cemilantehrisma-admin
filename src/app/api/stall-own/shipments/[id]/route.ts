import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/db-retry';
import { requirePermission } from '@/lib/rbac';
import { auditConsign } from '@/lib/consign-audit';
import { OwnError, moveWarehouseStock, rowToShipment, type ShipmentRow } from '@/lib/stall-own';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan dokumen: stok dikembalikan ke posisi semula (gagal bila stoknya sudah terpakai/terjual).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'stall-own', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  try {
    const row = await withDeadlockRetry(() => sql.begin(async tx => {
      const [d] = await tx<ShipmentRow[]>`select * from stall_shipments where id = ${id} for update`;
      if (!d) throw new OwnError('NOT_FOUND');
      if (d.status === 'void') throw new OwnError('Dokumen ini sudah dibatalkan.');
      // Gudang lapak SAAT dokumen dibuat (bukan gudang terkait lapak sekarang, yang bisa sudah diganti).
      const [stall] = await tx<{ warehouse_id: string | null }[]>`select coalesce(${d.stall_warehouse_id ?? null}::text, warehouse_id) as warehouse_id from stalls where id = ${d.stall_id}`;
      const shipment = rowToShipment(d);
      if (d.kind !== 'opening') {
        if (!stall?.warehouse_id || !d.from_warehouse_id) throw new OwnError('Gudang dokumen ini sudah tidak tersedia.');
        const [stallWh] = await tx<{ name: string }[]>`select name from warehouses where id = ${stall.warehouse_id}`;
        const [other] = await tx<{ name: string }[]>`select name from warehouses where id = ${d.from_warehouse_id}`;
        const items = shipment.items.map(i => ({ productId: i.productId, name: i.name, qty: i.qty }));
        // Kebalikan dari dokumennya.
        const back = d.kind === 'send'
          ? { fromId: stall.warehouse_id, fromName: stallWh?.name ?? '', toId: d.from_warehouse_id, toName: other?.name ?? '' }
          : { fromId: d.from_warehouse_id, fromName: other?.name ?? '', toId: stall.warehouse_id, toName: stallWh?.name ?? '' };
        await moveWarehouseStock(tx, { ...back, items, note: `Batal ${d.doc_number}` });
      }
      const [r] = await tx<ShipmentRow[]>`update stall_shipments set status = 'void', voided_by = ${guard.username}, voided_at = now() where id = ${id} returning *`;
      return r;
    }));
    await auditConsign(guard, 'delete', 'stall-shipments', id, `${row.doc_number} (${row.stall_name})`, { status: 'active' }, { status: 'void' });
    return Response.json({ shipment: rowToShipment(row) });
  } catch (err) {
    if (err instanceof OwnError) {
      return err.message === 'NOT_FOUND' ? Response.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404 }) : Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
