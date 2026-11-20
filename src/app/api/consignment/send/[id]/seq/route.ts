import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { parseDeliverySeq } from '@/lib/shipment-seq';
import { normalizeShipmentStatus } from '@/lib/shipment-status';

type Ctx = { params: Promise<{ id: string }> };

// Atur nomor urutan pengiriman satu draf (mengurutkan mitra di pesan WA Rencana Kirim). Hanya menulis kolom
// delivery_seq: TIDAK menyentuh stok/status/isi dokumen dan tidak mengubah updated_at (jadi tidak membuat form edit
// yang sedang terbuka dianggap basi). Hanya untuk draf; body { deliverySeq: number | null } (null = hapus urutan).
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { deliverySeq?: unknown };
  const seq = parseDeliverySeq(body.deliverySeq);
  if (seq === 'invalid') return Response.json({ error: 'Urutan pengiriman harus bilangan bulat 1-999.' }, { status: 400 });

  const sql = getSql();
  const [row] = await sql<{ status: string | null }[]>`select status from consignment_shipments where id = ${id}`;
  if (!row) return Response.json({ error: 'Pengiriman tidak ditemukan.' }, { status: 404 });
  if (normalizeShipmentStatus(row.status) !== 'draft') return Response.json({ error: 'Urutan hanya bisa diatur untuk draft.' }, { status: 409 });
  // Cek status diulang di UPDATE supaya approve yang menyelip tidak membuat draf terlewat.
  const updated = await sql`update consignment_shipments set delivery_seq = ${seq} where id = ${id} and status = 'draft' returning id`;
  if (updated.length === 0) return Response.json({ error: 'Draft sudah berubah status, muat ulang.' }, { status: 409 });
  revalidateTag('admin-consignment-shipments-list', { expire: 0 });
  return Response.json({ ok: true, deliverySeq: seq });
}
