import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { guardStall, rowToShift, type ShiftRow } from '@/lib/stall-pos-server';
import { auditConsign } from '@/lib/consign-audit';

export async function GET(req: NextRequest) {
  const guard = await guardStall(req, 'view', new URL(req.url).searchParams.get('stallId'));
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [row] = await sql<ShiftRow[]>`select * from stall_shifts where stall_id = ${guard.stall.id} and status = 'open'`;
  return Response.json({ shift: row ? rowToShift(row) : null });
}

// Buka shift: satu shift terbuka per lapak (dijaga unique index di database).
export async function POST(req: NextRequest) {
  const data = await req.json() as { stallId?: string; openingBalance?: number; note?: string };
  const guard = await guardStall(req, 'create', data.stallId ?? null);
  if (guard instanceof Response) return guard;
  if (!guard.stall.is_active) return Response.json({ error: 'Lapak nonaktif.' }, { status: 400 });
  const openingBalance = Number(data.openingBalance) || 0;
  if (openingBalance < 0) return Response.json({ error: 'Kas awal tidak valid.' }, { status: 400 });
  const sql = getSql();
  const id = randomUUID();
  try {
    await sql`
      insert into stall_shifts (id, stall_id, opened_by, opening_balance, note, status, opened_at)
      values (${id}, ${guard.stall.id}, ${guard.user.username}, ${openingBalance}, ${(data.note ?? '').trim().slice(0, 200)}, 'open', now())
    `;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return Response.json({ error: 'Shift di lapak ini sudah terbuka.' }, { status: 409 });
    }
    throw err;
  }
  const [row] = await sql<ShiftRow[]>`select * from stall_shifts where id = ${id}`;
  await auditConsign(guard.user, 'create', 'stall-shifts', id, `Buka kasir ${guard.stall.name}`, null, { openingBalance });
  return Response.json({ shift: rowToShift(row) });
}
