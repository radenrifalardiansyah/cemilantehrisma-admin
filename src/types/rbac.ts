export type Action = 'view' | 'create' | 'edit' | 'delete';

export interface Role {
  id: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PermissionCell = Partial<Record<Action, boolean>>;

export interface RolePermissionsDoc {
  permissions: Record<string, PermissionCell>;
  updatedAt?: unknown;
}

export interface ModuleDoc {
  id: string;
  name: string;
  icon: string;
  order: number;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MenuDoc {
  id: string;
  moduleId: string;
  parentId: string | null;
  featureKey: string;
  label: string;
  icon: string;
  order: number;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}
