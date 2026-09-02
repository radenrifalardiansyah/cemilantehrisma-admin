import { NextRequest, after } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';

interface ImportRow {
  slug?: string; name: string; emoji?: string; description?: string;
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'categories', 'create');
  if (guard instanceof Response) return guard;
  const { categories } = await req.json() as { categories: ImportRow[] };
  if (!Array.isArray(categories) || categories.length === 0) {
    return Response.json({ error: 'Tidak ada data kategori untuk diimpor.' }, { status: 400 });
  }

  const sql = getSql();
  const existingRows = await sql<{ id: string }[]>`select id from categories`;
  const existingSlugs = new Set(existingRows.map(r => r.id));
  const seenSlugs = new Set<string>();
  // max(order)+1, bukan jumlah dokumen — lihat komentar sama di api/categories/route.ts POST.
  const [{ max_order }] = await sql<{ max_order: number | null }[]>`select max(sort_order) as max_order from categories`;
  let nextOrder = (max_order ?? -1) + 1;

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;

  for (const row of categories) {
    const name = (row.name ?? '').toString().trim();
    if (!name) { skippedInvalid++; continue; }
    const slug = (row.slug ?? '').toString().trim() || slugify(name);
    if (!slug || existingSlugs.has(slug) || seenSlugs.has(slug)) { skippedDuplicate++; continue; }

    seenSlugs.add(slug);
    await sql`
      insert into categories (id, name, emoji, description, sort_order, banner_url, created_at, updated_at)
      values (${slug}, ${name}, ${(row.emoji ?? '').toString().trim() || '🏷️'}, ${(row.description ?? '').toString().trim()}, ${nextOrder++}, '', now(), now())
    `;
    created++;
  }

  if (created > 0) after(() => revalidateStorefront('categories'));
  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
