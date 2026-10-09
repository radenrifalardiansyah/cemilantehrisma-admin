import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { nextCode } from '@/lib/consign-pg';
import { validateScheme } from '@/lib/consign';
import { parseIdNumber } from '@/lib/excel-cell';
import { auditConsign } from '@/lib/consign-audit';

interface ImportRow {
  name?: string; phone?: string; address?: string; scheme?: string; value?: string;
  bankName?: string; bankAccount?: string; bankHolder?: string; note?: string;
}

const MAX_ROWS = 1000;
const t = (v: unknown) => (v ?? '').toString().trim();

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const { consignors } = await req.json() as { consignors: ImportRow[] };
  if (!Array.isArray(consignors) || consignors.length === 0) {
    return Response.json({ error: 'Tidak ada data penitip untuk diimpor.' }, { status: 400 });
  }
  if (consignors.length > MAX_ROWS) {
    return Response.json({ error: `Maksimal ${MAX_ROWS} baris per impor.` }, { status: 400 });
  }

  const sql = getSql();
  const existing = await sql<{ name: string; code: string | null }[]>`select name, code from consignors`;
  const names = new Set(existing.map(r => r.name.trim().toLowerCase()));
  const codePool = existing.map(r => r.code);

  let created = 0, skippedDuplicate = 0;
  const errors: string[] = [];

  for (let i = 0; i < consignors.length; i++) {
    const row = consignors[i];
    const label = `Baris ${i + 1}`;
    const name = t(row.name);
    if (!name) { errors.push(`${label}: nama kosong`); continue; }
    if (names.has(name.toLowerCase())) { skippedDuplicate++; continue; }

    // Skema: kosong → belum ditentukan (produk wajib punya skema sendiri); "komisi"/"persen"/"%"
    // → commission; selain itu ("nominal"/"setor") → nominal.
    const schemeText = t(row.scheme).toLowerCase();
    const scheme = !schemeText ? null : /komisi|persen|%/.test(schemeText) ? 'commission' as const : 'nominal' as const;
    const valueText = t(row.value);
    const value = scheme && valueText ? parseIdNumber(valueText) : 0;
    const err = scheme ? (Number.isFinite(value) ? validateScheme(scheme, value) : 'nilai bagi hasil bukan angka') : null;
    if (err) { errors.push(`${label} (${name}): ${err}`); continue; }

    const code = nextCode('PNT', codePool);
    codePool.push(code);
    names.add(name.toLowerCase());
    try {
      await sql`
        insert into consignors (id, code, name, phone, address, bank_name, bank_account, bank_holder, note, scheme, scheme_value, is_active, created_at, updated_at)
        values (${randomUUID()}, ${code}, ${name}, ${t(row.phone)}, ${t(row.address)}, ${t(row.bankName)}, ${t(row.bankAccount)}, ${t(row.bankHolder)},
          ${t(row.note)}, ${scheme}, ${value}, true, now(), now())
      `;
      created++;
    } catch (e) {
      console.error('Bulk import penitip: gagal menyimpan baris', name, e);
      errors.push(`${label} (${name}): gagal disimpan`);
    }
  }

  if (created > 0) await auditConsign(guard, 'create', 'consignors', 'bulk-import', `Impor ${created} penitip`, null, { created });
  return Response.json({ created, skippedDuplicate, errors: errors.slice(0, 10), errorCount: errors.length });
}
