import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { canAccessRoom } from '@/lib/chat';

type Ctx = { params: Promise<{ roomId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const { roomId } = await ctx.params;
  if (!canAccessRoom(roomId, authUser.username)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // `upTo` = createdAt pesan TERAKHIR yang benar-benar sudah diambil klien (dikirim dari
  // ChatThread setelah loadMessages selesai). Tanpa ini, watermark dulu diset ke waktu SERVER
  // saat request ini sampai — kalau lawan bicara kirim pesan baru tepat di celah antara fetch
  // pesan dan request ini, pesan itu bisa punya createdAt <= watermark baru padahal klien belum
  // pernah menampilkannya, membuat badge unread untuk pesan itu salah tersembunyi.
  const { upTo } = await req.json().catch(() => ({ upTo: undefined })) as { upTo?: string };
  const upToDate = upTo ? new Date(upTo) : null;
  const lastReadAt = upToDate && !isNaN(upToDate.getTime()) ? upToDate : new Date();

  const sql = getSql();
  await sql`
    insert into chat_reads (room_id, username, last_read_at) values (${roomId}, ${authUser.username}, ${lastReadAt})
    on conflict (room_id, username) do update set last_read_at = ${lastReadAt}
  `;

  return Response.json({ ok: true });
}
