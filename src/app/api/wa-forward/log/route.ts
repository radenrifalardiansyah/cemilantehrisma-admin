import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Riwayat pesan yang diteruskan (terbaru dulu). ?locationId= untuk filter satu mitra; ?limit= maks 200.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wa-forward', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const locationId = req.nextUrl.searchParams.get('locationId') ?? '';
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
  const rows = await sql<{
    id: string; location_id: string | null; location_name: string; sender_name: string; body: string;
    status: string; error: string | null; received_at: Date; sent_at: Date | null;
  }[]>`
    select id, location_id, location_name, sender_name, body, status, error, received_at, sent_at
    from wa_forward_log ${locationId ? sql`where location_id = ${locationId}` : sql``}
    order by received_at desc limit ${limit}
  `;
  return Response.json({
    logs: rows.map(r => ({
      id: r.id, locationId: r.location_id, locationName: r.location_name, senderName: r.sender_name, body: r.body,
      status: r.status, error: r.error, receivedAt: r.received_at.toISOString(), sentAt: r.sent_at ? r.sent_at.toISOString() : null,
    })),
  });
}
