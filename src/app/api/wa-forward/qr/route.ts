import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// QR login worker untuk di-scan dari halaman admin. Hanya untuk yang berhak mengubah (edit): siapa pun yang men-scan QR ini
// mendapat akses ke akun WhatsApp. QR kedaluwarsa cepat (±20 dtk), jadi yang lebih tua dari 90 detik dianggap tidak ada.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wa-forward', 'edit');
  if (guard instanceof Response) return guard;
  const [row] = await getSql()<{ worker_qr: string | null; fresh: boolean }[]>`
    select worker_qr, coalesce(worker_qr_at > now() - interval '90 seconds', false) as fresh from wa_forward_settings where id = 1
  `;
  const res = Response.json({ qr: row?.fresh ? row.worker_qr : null });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
