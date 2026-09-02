import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';

export async function POST(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const sql = getSql();
  await sql`
    insert into presence (username, last_seen) values (${authUser.username}, now())
    on conflict (username) do update set last_seen = now()
  `;
  return Response.json({ ok: true });
}
