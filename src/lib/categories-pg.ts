export interface CategoryRow {
  id: string; name: string; emoji: string | null; description: string | null;
  banner_url: string | null; sort_order: number | null;
  created_at: Date; updated_at: Date | null;
}

export function rowToCategory(r: CategoryRow) {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji ?? '',
    description: r.description ?? '',
    bannerUrl: r.banner_url ?? '',
    order: r.sort_order ?? 0,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}
