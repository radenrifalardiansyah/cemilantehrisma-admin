import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getSql } from '@/lib/db';
import { BULK_APPROVE_MAX } from '@/lib/shipment-status';
import { approveShipmentDb, revalidateShipmentCaches, scheduleApproveEffects, ShipmentActionError } from '@/lib/shipment-workflow';

// Efek samping di after() ikut dibatasi durasi fungsi; 60 detik (batas aman semua plan Vercel) memberi ruang
// untuk efek 25 pengiriman dengan FCM yang lambat, supaya riwayat/notifikasi tidak terpotong diam-diam.
export const maxDuration = 60;

// Approve massal Kirim Stok dari centang — berurutan (bukan paralel: tiap approve mengunci stok yang
// bisa dipakai draft berikutnya, dan validasi stok harus melihat hasil approve sebelumnya). Tiap
// pengiriman transaksi sendiri, jadi satu yang gagal (mis. stok kurang) tidak menggagalkan yang lain.
// Efek samping non-DB (riwayat, notifikasi, low-stock) semua shipment yang berhasil dijalankan SETELAH respons
// (after()), jadi klien tidak menunggu Firestore/FCM; revalidate tetap dipanggil sebelum respons.
// Dibatasi BULK_APPROVE_MAX per request supaya tidak mendekati batas durasi fungsi; klien memecah
// pilihan yang lebih besar menjadi beberapa batch.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'approve');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json().catch(() => ({})) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || ids.some(x => typeof x !== 'string')) {
    return Response.json({ error: 'ids required' }, { status: 400 });
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length > BULK_APPROVE_MAX) {
    return Response.json({ error: `Maksimal ${BULK_APPROVE_MAX} pengiriman per request approve massal — kirim dalam beberapa batch.` }, { status: 400 });
  }

  const sql = getSql();
  const approved: string[] = [];
  const effects: (() => Promise<void>)[] = [];
  const failed: { id: string; label: string; reason: string }[] = [];
  try {
    for (const id of unique) {
      try {
        const { runEffects } = await approveShipmentDb(id, guard);
        approved.push(id);
        effects.push(runEffects);
      } catch (err) {
        // approveShipment sudah mengubah error tak terduga jadi ShipmentActionError generik (dan log); sisanya
        // (di luar itu) dilog di sini dan tidak dibocorkan ke klien.
        if (!(err instanceof ShipmentActionError)) console.error('bulk approve consignment send', err);
        const [r] = await sql<{ location_name: string | null }[]>`select location_name from consignment_shipments where id = ${id}`.catch(() => []);
        failed.push({ id, label: r?.location_name ?? id, reason: err instanceof ShipmentActionError ? err.message : 'Gagal approve, coba lagi' });
      }
    }
  } finally {
    // Walau loop terputus di tengah, approve yang sudah ter-commit harus membuang cache.
    if (approved.length > 0) revalidateShipmentCaches(approved, { stock: true });
    await scheduleApproveEffects(effects);
  }
  return Response.json({ approved: approved.length, failed });
}
