import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FEATURE_KEY_SET } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'menus', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    moduleId?: string; parentId?: string | null; featureKey?: string | null; label?: string; icon?: string; isActive?: boolean;
  };

  if (typeof data.featureKey === 'string' && !FEATURE_KEY_SET.has(data.featureKey)) {
    return Response.json({ error: `Screen "${data.featureKey}" tidak dikenal.` }, { status: 400 });
  }

  const sql = getSql();
  const [current] = await sql<{ feature_key: string | null; is_active: boolean; parent_id: string | null }[]>`select feature_key, is_active, parent_id from menus where id = ${id}`;
  if (!current) return Response.json({ error: 'Menu tidak ditemukan.' }, { status: 404 });

  // Tolak parentId yang bikin siklus — perlindungan ini sebelumnya cuma ada di klien (menyaring
  // dropdown pemilihan induk), yang bisa dilewati lewat panggilan API langsung. Kalau sampai
  // tersimpan, kode yang menyusun pohon menu (MenusTab.tsx) merekursi tanpa visited-set dan bisa
  // stack-overflow saat merender Struktur Menu.
  if (typeof data.parentId === 'string' && data.parentId) {
    if (data.parentId === id) {
      return Response.json({ error: 'Menu tidak bisa menjadi induk dirinya sendiri.' }, { status: 400 });
    }
    const allMenus = await sql<{ id: string; parent_id: string | null }[]>`select id, parent_id from menus`;
    const parentById = new Map(allMenus.map(r => [r.id, r.parent_id]));
    const seen = new Set<string>();
    let cursor: string | null | undefined = data.parentId;
    while (cursor) {
      if (cursor === id) {
        return Response.json({ error: 'Induk yang dipilih akan membuat struktur menu melingkar (siklus).' }, { status: 400 });
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = parentById.get(cursor);
    }
  }

  // data.featureKey === undefined -> field not touched, keep current value.
  // data.featureKey === null / '' -> explicitly cleared -> menu becomes a folder.
  // `coalesce` can't express "set to null" (coalesce(null, x) just returns x), so the
  // final value is resolved here in JS and written as a plain assignment below instead.
  const featureKeyProvided = data.featureKey !== undefined;
  const nextFeatureKey = featureKeyProvided ? (data.featureKey || null) : current.feature_key;
  const nextActive = data.isActive ?? current.is_active;
  if (nextActive && nextFeatureKey) {
    const [conflict] = await sql<{ id: string; label: string }[]>`select id, label from menus where feature_key = ${nextFeatureKey} and is_active = true and id != ${id} limit 1`;
    if (conflict) {
      return Response.json(
        { error: `Screen "${nextFeatureKey}" sudah punya menu aktif ("${conflict.label}").` },
        { status: 409 },
      );
    }
  }

  const nextParentId = data.parentId !== undefined ? (data.parentId || null) : current.parent_id;
  await sql`
    update menus set
      module_id = coalesce(${data.moduleId ?? null}, module_id),
      parent_id = ${nextParentId},
      feature_key = ${nextFeatureKey},
      label = coalesce(${data.label ?? null}, label),
      icon = coalesce(${data.icon ?? null}, icon),
      is_active = coalesce(${data.isActive ?? null}, is_active),
      updated_at = now()
    where id = ${id}
  `;
  revalidateTag('modules-and-menus', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'menus', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();

  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from menus where parent_id = ${id}`;
  if (count > 0) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${count} sub-menu masih menggunakan menu ini sebagai induk.` },
      { status: 409 },
    );
  }

  await sql`delete from menus where id = ${id}`;
  revalidateTag('modules-and-menus', { expire: 0 });
  return Response.json({ ok: true });
}
