import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Nyalakan/Matikan koneksi WhatsApp worker dari admin ({ on: boolean }). Worker membaca ini pada panggilan config berikutnya
// (±1 menit): mati = memutus koneksi tapi program tetap standby (sesi login tersimpan); nyala = menyambung lagi.
// Tidak bisa menghidupkan program worker yang sudah mati di komputernya.
export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'wa-forward', 'edit');
  if (guard instanceof Response) return guard;
  const b = await req.json().catch(() => null) as { on?: unknown } | null;
  if (typeof b?.on !== 'boolean') return Response.json({ error: '"on" harus true/false.' }, { status: 400 });
  await getSql()`update wa_forward_settings set worker_desired = ${b.on}, updated_by = ${guard.username}, updated_at = now() where id = 1`;
  return Response.json({ ok: true });
}
