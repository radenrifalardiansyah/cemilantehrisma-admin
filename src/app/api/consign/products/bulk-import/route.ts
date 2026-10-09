import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { nextCode } from '@/lib/consign-pg';
import { validateScheme } from '@/lib/consign';
import { syncStallItems } from '@/lib/consign-products';
import { parseIdNumber } from '@/lib/excel-cell';
import { auditConsign } from '@/lib/consign-audit';

interface ImportRow {
  consignor?: string; name?: string; unit?: string; price?: string; scheme?: string; value?: string; stalls?: string; note?: string;
  category?: string; weight?: string; description?: string;
}

const MAX_ROWS = 2000;
const t = (v: unknown) => (v ?? '').toString().trim();
const key = (v: string) => v.trim().toLowerCase();

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const { products } = await req.json() as { products: ImportRow[] };
  if (!Array.isArray(products) || products.length === 0) {
    return Response.json({ error: 'Tidak ada data produk untuk diimpor.' }, { status: 400 });
  }
  if (products.length > MAX_ROWS) {
    return Response.json({ error: `Maksimal ${MAX_ROWS} baris per impor.` }, { status: 400 });
  }

  const sql = getSql();
  const [consignors, stalls, existing, categories] = await Promise.all([
    sql<{ id: string; name: string; code: string | null; scheme: string | null }[]>`select id, name, code, scheme from consignors`,
    sql<{ id: string; name: string; code: string | null }[]>`select id, name, code from stalls`,
    sql<{ code: string | null; consignor_id: string; name: string }[]>`select code, consignor_id, name from consign_products`,
    sql<{ id: string; name: string }[]>`select id, name from categories`,
  ]);
  // Kategori dicocokkan lewat nama ATAU id (tidak peka huruf besar/kecil).
  const categoryBy = new Map<string, string>();
  for (const c of categories) { categoryBy.set(key(c.name), c.id); categoryBy.set(key(c.id), c.id); }
  // Penitip & lapak dicocokkan lewat nama ATAU kode (tidak peka huruf besar/kecil).
  const consignorBy = new Map<string, string>();
  const consignorHasScheme = new Map<string, boolean>();
  for (const c of consignors) {
    consignorBy.set(key(c.name), c.id); if (c.code) consignorBy.set(key(c.code), c.id);
    consignorHasScheme.set(c.id, !!c.scheme);
  }
  const stallBy = new Map<string, string>();
  for (const s of stalls) { stallBy.set(key(s.name), s.id); if (s.code) stallBy.set(key(s.code), s.id); }
  const seen = new Set(existing.map(p => `${p.consignor_id}|${key(p.name)}`));
  const codePool = existing.map(p => p.code);

  let created = 0, skippedDuplicate = 0;
  const errors: string[] = [];

  for (let i = 0; i < products.length; i++) {
    const row = products[i];
    const name = t(row.name);
    const label = `Baris ${i + 1}${name ? ` (${name})` : ''}`;
    if (!name) { errors.push(`${label}: nama produk kosong`); continue; }
    const consignorId = consignorBy.get(key(t(row.consignor)));
    if (!consignorId) { errors.push(`${label}: penitip "${t(row.consignor)}" tidak ditemukan`); continue; }
    if (seen.has(`${consignorId}|${key(name)}`)) { skippedDuplicate++; continue; }

    const price = parseIdNumber(t(row.price));
    if (!Number.isFinite(price) || price < 0) { errors.push(`${label}: harga jual tidak valid`); continue; }

    // Skema kosong = ikut skema default penitip.
    let scheme: 'nominal' | 'commission' | null = null;
    let schemeValue: number | null = null;
    const schemeText = t(row.scheme).toLowerCase();
    if (schemeText) {
      scheme = /komisi|persen|%/.test(schemeText) ? 'commission' : 'nominal';
      schemeValue = parseIdNumber(t(row.value));
      const err = Number.isFinite(schemeValue) ? validateScheme(scheme, schemeValue, price) : 'nilai bagi hasil bukan angka';
      if (err) { errors.push(`${label}: ${err}`); continue; }
    }

    if (!scheme && !consignorHasScheme.get(consignorId)) {
      errors.push(`${label}: penitip "${t(row.consignor)}" belum punya skema default — isi kolom Skema & Nilai`); continue;
    }

    const categoryText = t(row.category);
    const categoryId = categoryText ? categoryBy.get(key(categoryText)) : '';
    if (categoryText && !categoryId) { errors.push(`${label}: kategori "${categoryText}" tidak ditemukan`); continue; }

    const stallIds: string[] = [];
    let stallErr = '';
    for (const part of t(row.stalls).split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
      const sid = stallBy.get(key(part));
      if (!sid) { stallErr = `lapak "${part}" tidak ditemukan`; break; }
      if (!stallIds.includes(sid)) stallIds.push(sid);
    }
    if (stallErr) { errors.push(`${label}: ${stallErr}`); continue; }

    const id = randomUUID();
    const code = nextCode('TJP', codePool);
    try {
      await sql.begin(async tx => {
        await tx`
          insert into consign_products (id, code, consignor_id, name, unit, default_price, scheme, scheme_value, note, is_active, category, weight, description, created_at, updated_at)
          values (${id}, ${code}, ${consignorId}, ${name}, ${t(row.unit) || 'pcs'}, ${price}, ${scheme}, ${schemeValue}, ${t(row.note)}, true, ${categoryId ?? ''}, ${t(row.weight).slice(0, 40)}, ${t(row.description).slice(0, 2000)}, now(), now())
        `;
        const e = await syncStallItems(tx, id, stallIds.map(stallId => ({ stallId, price: null, scheme: null, schemeValue: null })));
        if (e) throw new Error(e);
      });
      codePool.push(code);
      seen.add(`${consignorId}|${key(name)}`);
      created++;
    } catch (e) {
      console.error('Bulk import produk titipan: gagal menyimpan baris', name, e);
      errors.push(`${label}: gagal disimpan`);
    }
  }

  if (created > 0) await auditConsign(guard, 'create', 'products', 'bulk-import', `Impor ${created} produk titipan`, null, { created });
  return Response.json({ created, skippedDuplicate, errors: errors.slice(0, 10), errorCount: errors.length });
}
