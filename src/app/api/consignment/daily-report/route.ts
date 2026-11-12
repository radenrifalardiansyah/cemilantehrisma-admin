import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart } from '@/lib/date';
import { SHIPMENT_APPROVED } from '@/lib/shipment-status';
import { rowToShipment, type ShipmentRow } from '@/lib/shipments-pg';
import { rowToRecap, type RecapRow } from '@/lib/recaps-pg';
import { buildMitraDailyReport, type DailyReportRecap } from '@/lib/mitra-daily-report';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface LocationRow { id: string; name: string; code: string | null; contact_name: string | null; contact_phone: string | null; is_active: boolean | null }
interface StockRow { location_id: string; product_id: string; product_name: string; stock_qty: string | number; harga_titip: string | number | null }

// Laporan Harian Mitra: per mitra, per hari, per produk — kirim, jual, retur, reject, stok akhir.
// Dihitung di server dalam satu kali jalan (bukan N+1 per mitra). Stok akhir hari D dihitung mundur dari
// stok saat ini, jadi cukup membaca kirim/rekap sejak awal rentang (`from`) — yang lebih lama tidak
// memengaruhi stok akhir hari mana pun di dalam rentang. Izin sendiri ('mitra-report'), terpisah dari Mitra.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'mitra-report', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return Response.json({ error: 'Rentang tanggal tidak valid.' }, { status: 400 });
  }

  const sql = getSql();
  const since = wibDayStart(from).toDate();
  const [locRows, stockRows, shipRows, recapRows] = await Promise.all([
    sql<LocationRow[]>`select id, name, code, contact_name, contact_phone, is_active from consignment_locations order by name asc`,
    sql<StockRow[]>`select location_id, product_id, product_name, stock_qty, harga_titip from consignment_stock`,
    sql<ShipmentRow[]>`select * from consignment_shipments where created_at >= ${since} and status = ${SHIPMENT_APPROVED}`,
    sql<RecapRow[]>`select * from consignment_recaps where created_at >= ${since}`,
  ]);

  const stockByLocation: Record<string, { productId: string; productName: string; stockQty: number; hargaTitip: number }[]> = {};
  for (const r of stockRows) {
    (stockByLocation[r.location_id] ??= []).push({ productId: r.product_id, productName: r.product_name, stockQty: Number(r.stock_qty), hargaTitip: Number(r.harga_titip) || 0 });
  }

  const sections = buildMitraDailyReport({
    locations: locRows.map(l => ({ id: l.id, name: l.name })),
    stockByLocation,
    shipments: shipRows.map(rowToShipment),
    recaps: recapRows.map(rowToRecap) as unknown as DailyReportRecap[], // items = jsonb RecapItem[]
    from, to,
  });

  const meta = new Map(locRows.map(l => [l.id, l]));
  return Response.json({
    from, to,
    sections: sections.map(s => {
      const m = meta.get(s.locationId)!;
      return {
        ...s,
        code: m.code ?? '', contactName: m.contact_name ?? '', contactPhone: m.contact_phone ?? '',
        isActive: m.is_active !== false,
      };
    }),
  });
}
