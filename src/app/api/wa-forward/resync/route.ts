import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Minta worker memuat ulang daftar grup WA pada panggilan config berikutnya (±1 menit).
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wa-forward', 'edit');
  if (guard instanceof Response) return guard;
  await getSql()`update wa_forward_settings set resync_requested = true where id = 1`;
  return Response.json({ ok: true });
}
