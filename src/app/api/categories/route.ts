import { NextRequest, after } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';
import { rowToCategory, type CategoryRow } from '@/lib/categories-pg';

const getCachedCategories = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<CategoryRow[]>`select * from categories order by sort_order asc`;
    return rows.map(rowToCategory);
  },
  ['admin-categories'],
  { revalidate: 15, tags: ['admin-categories'] }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'categories', 'view');
  if (guard instanceof Response) return guard;
  const categories = await getCachedCategories();
  return Response.json({ categories });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'categories', 'create');
  if (guard instanceof Response) return guard;
  const { slug, name, emoji, description, bannerUrl } =
    await req.json() as { slug: string; name: string; emoji: string; description?: string; order?: number; bannerUrl?: string };

  if (!slug || !name) return Response.json({ error: 'Slug dan nama wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const [existing] = await sql<{ id: string }[]>`select id from categories where id = ${slug}`;
  if (existing) {
    return Response.json({ error: `Kategori dengan ID "${slug}" sudah ada.` }, { status: 409 });
  }

  // max(order)+1 dihitung SERVER-SIDE, bukan dipercaya dari klien (yang sebelumnya kirim
  // `categories.length + 1` — bisa bentrok dengan order kategori lain yang masih ada begitu
  // pernah ada penghapusan, karena jumlah kategori menyusut tapi nilai order yang tersisa tidak
  // ikut dipadatkan ulang; lihat komentar sama di api/menus & api/modules route.ts POST).
  const [{ max_order }] = await sql<{ max_order: number | null }[]>`select max(sort_order) as max_order from categories`;
  const nextOrder = (max_order ?? -1) + 1;

  await sql`
    insert into categories (id, name, emoji, description, sort_order, banner_url, created_at, updated_at)
    values (${slug}, ${name}, ${emoji || '🏷️'}, ${description ?? ''}, ${nextOrder}, ${bannerUrl ?? ''}, now(), now())
  `;
  revalidateTag('admin-categories', { expire: 0 });
  after(() => revalidateStorefront('categories'));
  return Response.json({ id: slug });
}
