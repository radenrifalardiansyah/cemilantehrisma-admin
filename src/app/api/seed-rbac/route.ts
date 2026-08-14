import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { permissionCell as cell, fullAccessPermissions as fullAccess } from '@/lib/permissions';
import type { Action } from '@/types/rbac';

type PermCell = Partial<Record<Action, boolean>>;

const ROLES: { id: string; name: string; description: string; isSystem?: boolean }[] = [
  { id: 'super-admin', name: 'Super Admin', description: 'Akses penuh ke seluruh sistem, tidak dapat dibatasi.', isSystem: true },
  { id: 'admin',       name: 'Admin',       description: 'Akses penuh untuk operasional harian & manajemen aplikasi.' },
  { id: 'staff',       name: 'Staff',       description: 'Akses operasional terbatas — produk, pesanan, stok.' },
  { id: 'kasir',       name: 'Kasir',       description: 'Akses kasir (POS) & pesanan.' },
  { id: 'finance',     name: 'Finance',     description: 'Akses data keuangan & laporan.' },
];

// Conservative starting points — fully adjustable afterward via Hak Akses
// Role. `super-admin`/`admin` get full access (matches what every existing
// user already has today, so nobody's capability regresses on rollout).
const STARTER_PERMISSIONS: Record<string, Record<string, PermCell>> = {
  'super-admin': fullAccess(),
  admin: fullAccess(),
  staff: {
    dashboard: cell(['view']),
    products: cell(['view', 'create', 'edit']),
    categories: cell(['view', 'create', 'edit']),
    orders: cell(['view', 'create', 'edit']),
    resellers: cell(['view', 'create', 'edit']),
    customers: cell(['view', 'create', 'edit']),
    consignment: cell(['view', 'create', 'edit']),
    stock: cell(['view', 'edit']),
    materials: cell(['view', 'create', 'edit']),
    suppliers: cell(['view', 'create', 'edit']),
    production: cell(['view', 'create', 'edit']),
  },
  kasir: {
    pos: cell(['view', 'create']),
    orders: cell(['view', 'create']),
    products: cell(['view']),
    categories: cell(['view']),
    customers: cell(['view', 'create']),
    resellers: cell(['view']),
    settings: cell(['view']),
    stock: cell(['view']),
  },
  finance: {
    dashboard: cell(['view']),
    income: cell(['view', 'create', 'edit', 'delete']),
    expenses: cell(['view', 'create', 'edit', 'delete']),
    capital: cell(['view', 'create', 'edit', 'delete']),
    'finance-report': cell(['view']),
    products: cell(['view']),
    orders: cell(['view']),
    resellers: cell(['view']),
    customers: cell(['view']),
    materials: cell(['view']),
  },
};

// Mirrors today's static NAV_GROUPS 1:1 (unchanged visual sidebar on first
// deploy) plus the 5 new nav entries under new "Users" and "App Management".
const MODULES = [
  { id: 'utama',          name: 'Utama',           icon: 'BarChart2',   order: 0 },
  { id: 'pos-group',      name: 'POS',             icon: 'ShoppingCart', order: 1 },
  { id: 'manajemen',      name: 'Manajemen',       icon: 'Package',     order: 2 },
  { id: 'keuangan',       name: 'Keuangan',        icon: 'Landmark',    order: 3 },
  { id: 'operasional',    name: 'Operasional',     icon: 'Warehouse',   order: 4 },
  { id: 'users-group',    name: 'Users',           icon: 'User',        order: 5 },
  { id: 'app-management', name: 'App Management',  icon: 'Archive',     order: 6 },
];

const MENUS: { id: string; moduleId: string; parentId: string | null; featureKey: string; label: string; icon: string; order: number }[] = [
  { id: 'dashboard', moduleId: 'utama', parentId: null, featureKey: 'dashboard', label: 'Analitik', icon: 'BarChart2', order: 0 },

  { id: 'pos',    moduleId: 'pos-group', parentId: null, featureKey: 'pos',    label: 'Kasir',   icon: 'ShoppingCart', order: 0 },
  { id: 'orders', moduleId: 'pos-group', parentId: null, featureKey: 'orders', label: 'Pesanan', icon: 'Receipt',      order: 1 },

  { id: 'products',    moduleId: 'manajemen', parentId: null,       featureKey: 'products',    label: 'Produk',    icon: 'Package', order: 0 },
  { id: 'categories',  moduleId: 'manajemen', parentId: 'products', featureKey: 'categories',  label: 'Kategori',  icon: 'Tag',      order: 0 },
  { id: 'resellers',   moduleId: 'manajemen', parentId: null,       featureKey: 'resellers',   label: 'Reseller',  icon: 'Users',    order: 1 },
  { id: 'customers',   moduleId: 'manajemen', parentId: null,       featureKey: 'customers',   label: 'Pelanggan', icon: 'Contact',  order: 2 },
  { id: 'consignment', moduleId: 'manajemen', parentId: null,       featureKey: 'consignment', label: 'Mitra',     icon: 'Store',    order: 3 },

  { id: 'income',          moduleId: 'keuangan', parentId: null, featureKey: 'income',          label: 'Pemasukan',        icon: 'Coins',     order: 0 },
  { id: 'expenses',        moduleId: 'keuangan', parentId: null, featureKey: 'expenses',        label: 'Pengeluaran',      icon: 'Banknote',  order: 1 },
  { id: 'capital',         moduleId: 'keuangan', parentId: null, featureKey: 'capital',         label: 'Modal & Prive',    icon: 'Landmark',  order: 2 },
  { id: 'finance-report',  moduleId: 'keuangan', parentId: null, featureKey: 'finance-report',  label: 'Laporan Keuangan', icon: 'LineChart', order: 3 },

  { id: 'stock',        moduleId: 'operasional', parentId: null,        featureKey: 'stock',        label: 'Gudang',       icon: 'Warehouse',    order: 0 },
  { id: 'materials',    moduleId: 'operasional', parentId: null,        featureKey: 'materials',    label: 'Bahan Baku',   icon: 'Boxes',        order: 1 },
  { id: 'suppliers',    moduleId: 'operasional', parentId: 'materials', featureKey: 'suppliers',    label: 'Supplier',     icon: 'Truck',        order: 0 },
  { id: 'production',   moduleId: 'operasional', parentId: 'materials', featureKey: 'production',   label: 'Produksi',     icon: 'Factory',      order: 1 },
  { id: 'stock-report', moduleId: 'operasional', parentId: null,        featureKey: 'stock-report', label: 'Laporan Stok', icon: 'FileBarChart', order: 2 },

  { id: 'users', moduleId: 'users-group', parentId: null, featureKey: 'users', label: 'Pengguna', icon: 'ShieldCheck', order: 0 },
  { id: 'roles', moduleId: 'users-group', parentId: null, featureKey: 'roles', label: 'Role',     icon: 'IdCard',      order: 1 },

  { id: 'settings',         moduleId: 'app-management', parentId: null, featureKey: 'settings',         label: 'Pengaturan',      icon: 'Settings',  order: 0 },
  { id: 'menus',            moduleId: 'app-management', parentId: null, featureKey: 'menus',            label: 'Struktur Menu',   icon: 'ListTree',  order: 1 },
  { id: 'role-permissions', moduleId: 'app-management', parentId: null, featureKey: 'role-permissions', label: 'Hak Akses Role',  icon: 'Lock',      order: 2 },
  { id: 'modules',          moduleId: 'app-management', parentId: null, featureKey: 'modules',          label: 'Modul',           icon: 'Blocks',    order: 3 },
  { id: 'history',          moduleId: 'app-management', parentId: null, featureKey: 'history',          label: 'Riwayat',         icon: 'History',   order: 4 },
  { id: 'notifications',    moduleId: 'app-management', parentId: null, featureKey: 'notifications',    label: 'Notifikasi',      icon: 'Bell',       order: 5 },
];

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const db = getDb();
  const now = FieldValue.serverTimestamp();

  let rolesSeeded = 0, permsSeeded = 0, modulesSeeded = 0, menusSeeded = 0;
  const backfilledRoles: string[] = [];

  for (const role of ROLES) {
    const ref = db.collection('roles').doc(role.id);
    if (!(await ref.get()).exists) {
      await ref.set({ name: role.name, description: role.description, isSystem: role.isSystem ?? false, createdAt: now, updatedAt: now });
      rolesSeeded++;
    }
    const permRef = db.collection('role_permissions').doc(role.id);
    if (!(await permRef.get()).exists) {
      await permRef.set({ permissions: STARTER_PERMISSIONS[role.id] ?? {}, updatedAt: now });
      permsSeeded++;
    }
  }

  // FEATURE_KEYS additions (like `history`, `notifications`) never
  // retroactively land on an already-seeded role_permissions doc — the
  // `!exists` guard above skips it entirely. Full-access roles should always
  // pick up new keys automatically, so merge them in here regardless of
  // prior seed state.
  for (const roleId of ['super-admin', 'admin']) {
    await db.collection('role_permissions').doc(roleId).set(
      { permissions: { history: cell(['view']), notifications: cell(['view']) }, updatedAt: now },
      { merge: true },
    );
  }

  // Verify (not assume) that every distinct `users.role` value in production
  // resolves to a role — backfill full access for anything unexpected so no
  // existing account is silently locked out once enforcement ships.
  const usersSnap = await db.collection('users').get();
  const knownRoleIds = new Set(ROLES.map(r => r.id));
  const distinctRoles = new Set(usersSnap.docs.map(d => (d.data().role as string | undefined) || 'admin'));
  for (const roleId of distinctRoles) {
    if (knownRoleIds.has(roleId)) continue;
    const ref = db.collection('roles').doc(roleId);
    if (!(await ref.get()).exists) {
      await ref.set({ name: roleId, description: 'Role lama (dibuat otomatis saat migrasi RBAC).', createdAt: now, updatedAt: now });
      rolesSeeded++;
    }
    const permRef = db.collection('role_permissions').doc(roleId);
    if (!(await permRef.get()).exists) {
      await permRef.set({ permissions: fullAccess(), updatedAt: now });
      permsSeeded++;
    }
    backfilledRoles.push(roleId);
  }

  for (const m of MODULES) {
    const ref = db.collection('modules').doc(m.id);
    if (!(await ref.get()).exists) {
      await ref.set({ name: m.name, icon: m.icon, order: m.order, isActive: true, createdAt: now, updatedAt: now });
      modulesSeeded++;
    }
  }

  for (const item of MENUS) {
    const ref = db.collection('menus').doc(item.id);
    if (!(await ref.get()).exists) {
      await ref.set({
        moduleId: item.moduleId, parentId: item.parentId, featureKey: item.featureKey,
        label: item.label, icon: item.icon, order: item.order, isActive: true,
        createdAt: now, updatedAt: now,
      });
      menusSeeded++;
    }
  }

  return Response.json({ rolesSeeded, permsSeeded, modulesSeeded, menusSeeded, backfilledRoles });
}
