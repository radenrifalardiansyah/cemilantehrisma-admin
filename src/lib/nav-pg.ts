import { toTimestamp } from '@/lib/orders-pg';

// Versi Postgres dari `modules`/`menus` (Tahap 24 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md).

export interface ModuleRow {
  id: string; name: string; icon: string; order: number; is_active: boolean;
  created_at: Date; updated_at: Date | null;
}

export function rowToModule(r: ModuleRow) {
  return {
    id: r.id, name: r.name, icon: r.icon, order: r.order, isActive: r.is_active,
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}

export interface MenuRow {
  id: string; module_id: string; parent_id: string | null; feature_key: string;
  label: string; icon: string; order: number; is_active: boolean;
  created_at: Date; updated_at: Date | null;
}

export function rowToMenu(r: MenuRow) {
  return {
    id: r.id, moduleId: r.module_id, parentId: r.parent_id, featureKey: r.feature_key,
    label: r.label, icon: r.icon, order: r.order, isActive: r.is_active,
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}
