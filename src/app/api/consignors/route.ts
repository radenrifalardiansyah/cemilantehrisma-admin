import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToConsignor, nextCode, parseSchemeInput, type ConsignorRow } from '@/lib/consign-pg';
import { validateScheme } from '@/lib/consign';
import { auditConsign } from '@/lib/consign-audit';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const rows = await sql<ConsignorRow[]>`select * from consignors order by created_at asc`;
  return Response.json({ consignors: rows.map(rowToConsignor) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return Response.json({ error: 'Nama penitip wajib diisi.' }, { status: 400 });

  const parsed = parseSchemeInput(data.scheme, data.schemeValue);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  // Skema default boleh kosong ("Belum ditentukan"): produk penitip ini lalu wajib punya skema sendiri.
  if (parsed.scheme) {
    const schemeErr = validateScheme(parsed.scheme, parsed.value ?? 0);
    if (schemeErr) return Response.json({ error: schemeErr }, { status: 400 });
  }

  const sql = getSql();
  const id = randomUUID();
  const existing = await sql<{ code: string | null }[]>`select code from consignors`;
  const code = nextCode('PNT', existing.map(r => r.code));
  await sql`
    insert into consignors (id, code, name, phone, address, bank_name, bank_account, bank_holder, note, logo_url, scheme, scheme_value, is_active, created_at, updated_at)
    values (${id}, ${code}, ${name}, ${(data.phone as string) ?? ''}, ${(data.address as string) ?? ''},
      ${(data.bankName as string) ?? ''}, ${(data.bankAccount as string) ?? ''}, ${(data.bankHolder as string) ?? ''},
      ${(data.note as string) ?? ''}, ${(data.logoUrl as string) || null}, ${parsed.scheme}, ${parsed.scheme ? (parsed.value ?? 0) : 0}, ${data.isActive !== false}, now(), now())
  `;
  await auditConsign(guard, 'create', 'consignors', id, `Penitip ${name}`, null, { code, name, scheme: parsed.scheme, schemeValue: parsed.value });
  return Response.json({ id, code });
}
