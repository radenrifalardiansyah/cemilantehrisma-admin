import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToStall, nextCode, type StallRow } from '@/lib/consign-pg';
import { normalizeInvoicePrefix } from '@/lib/stall-access';
import { validateStallUsernames } from './validate';
import { auditConsign } from '@/lib/consign-audit';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [rows, users, balances] = await Promise.all([
    sql<StallRow[]>`select * from stalls order by created_at asc`,
    sql<{ stall_id: string; username: string }[]>`select stall_id, username from stall_users order by username`,
    sql<{ stall_id: string; balance: string }[]>`select stall_id, sum(amount) as balance from stall_wallet_entries group by stall_id`,
  ]);
  const usersByStall = new Map<string, string[]>();
  for (const u of users) usersByStall.set(u.stall_id, [...(usersByStall.get(u.stall_id) ?? []), u.username]);
  const balanceByStall = new Map(balances.map(b => [b.stall_id, Number(b.balance)]));
  return Response.json({
    stalls: rows.map(r => ({ ...rowToStall(r), usernames: usersByStall.get(r.id) ?? [], balance: balanceByStall.get(r.id) ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return Response.json({ error: 'Nama lapak wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const warehouseId = typeof data.warehouseId === 'string' && data.warehouseId ? data.warehouseId : null;
  if (warehouseId) {
    const [w] = await sql`select id from warehouses where id = ${warehouseId}`;
    if (!w) return Response.json({ error: 'Gudang terkait tidak ditemukan.' }, { status: 400 });
  }
  const staff = await validateStallUsernames(sql, data.usernames);
  if ('error' in staff) return Response.json({ error: staff.error }, { status: 400 });

  const openingBalance = data.openingBalance === undefined || data.openingBalance === '' ? 0 : Number(data.openingBalance);
  if (!Number.isFinite(openingBalance) || openingBalance < 0) return Response.json({ error: 'Saldo awal dompet tidak valid.' }, { status: 400 });

  const id = randomUUID();
  const existing = await sql<{ code: string | null; invoice_prefix: string | null }[]>`select code, invoice_prefix from stalls`;
  const code = nextCode('LPK', existing.map(r => r.code));
  const prefix = data.invoicePrefix ? normalizeInvoicePrefix(data.invoicePrefix) : code;
  if (!prefix) return Response.json({ error: 'Awalan invoice hanya huruf/angka/tanda hubung, 2–12 karakter.' }, { status: 400 });
  if (existing.some(r => (r.invoice_prefix ?? r.code ?? '').toUpperCase() === prefix)) {
    return Response.json({ error: `Awalan invoice "${prefix}" sudah dipakai lapak lain.` }, { status: 400 });
  }

  await sql.begin(async tx => {
    await tx`
      insert into stalls (id, code, name, address, warehouse_id, note, is_active, invoice_prefix, show_own_products, created_at, updated_at)
      values (${id}, ${code}, ${name}, ${(data.address as string) ?? ''}, ${warehouseId}, ${(data.note as string) ?? ''}, ${data.isActive !== false}, ${prefix}, ${data.showOwnProducts === true && !!warehouseId}, now(), now())
    `;
    if (openingBalance > 0) {
      await tx`
        insert into stall_wallet_entries (id, stall_id, kind, amount, note, created_by, created_at)
        values (${randomUUID()}, ${id}, 'opening', ${openingBalance}, 'Saldo awal', ${guard.username}, now())
      `;
    }
    for (const username of staff.usernames) {
      await tx`insert into stall_users (stall_id, username, created_at) values (${id}, ${username}, now())`;
    }
  });
  await auditConsign(guard, 'create', 'stalls', id, `Lapak ${name}`, null, { code, name, warehouseId, invoicePrefix: prefix, usernames: staff.usernames, openingBalance });
  return Response.json({ id, code });
}
