'use client';

import { useEffect, useState } from 'react';
import { Lock, Check, Loader2, ShieldAlert, ChevronDown, CornerDownRight, CheckCheck } from 'lucide-react';
import { useToast } from '@/components/Toast';
import Tooltip from '@/components/Tooltip';
import { FEATURE_KEYS, getFeatureKeyDef } from '@/lib/permissions';
import { resolveIcon } from '@/lib/icon-registry';
import type { Role, Action, ModuleDoc, MenuDoc } from '@/types/rbac';

type Matrix = Record<string, Partial<Record<Action, boolean>>>;

const ACTION_LABELS: Record<Action, string> = { view: 'Lihat', create: 'Tambah', edit: 'Ubah', delete: 'Hapus' };
const ACTIONS: Action[] = ['view', 'create', 'edit', 'delete'];
// Fixed pixel widths applied literally to every row (header, module bar, data rows) so
// columns line up exactly — a CSS Grid per row can size its own tracks slightly
// differently even with an identical gridTemplateColumns, since each row is a separate grid.
const SELECT_COL_W = 32;
const ACTION_COL_W = 48;
const MATRIX_MIN_WIDTH = 460;

interface RolePermissionsTabProps { creds: string; can: (action: Action) => boolean }

export default function RolePermissionsTab({ creds, can }: RolePermissionsTabProps) {
  const toast   = useToast();
  const headers = { 'x-admin-auth': creds };

  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<Record<string, Matrix>>({});
  const [modules, setModules] = useState<ModuleDoc[]>([]);
  const [menus,   setMenus]   = useState<MenuDoc[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [matrix, setMatrix] = useState<Matrix>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const load = async () => {
    setLoading(true);
    const [rRes, pRes, mRes] = await Promise.all([
      fetch('/api/roles', { headers }),
      fetch('/api/role-permissions', { headers }),
      fetch('/api/menus?scope=manage', { headers }),
    ]);
    const rolesData = rRes.ok ? (await rRes.json() as { roles: Role[] }).roles : [];
    const permsData = pRes.ok ? (await pRes.json() as { rolePermissions: Record<string, Matrix> }).rolePermissions : {};
    if (mRes.ok) {
      const { modules: mods, menus: mns } = await mRes.json() as { modules: ModuleDoc[]; menus: MenuDoc[] };
      setModules(mods.slice().sort((a, b) => a.order - b.order));
      setMenus(mns);
    }
    setRoles(rolesData);
    setAllPermissions(permsData);
    const firstNonSystem = rolesData.find(r => !r.isSystem) ?? rolesData[0];
    if (firstNonSystem) {
      setSelectedRoleId(firstNonSystem.id);
      setMatrix(permsData[firstNonSystem.id] ?? {});
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectRole = (roleId: string) => {
    setSelectedRoleId(roleId);
    setMatrix(allPermissions[roleId] ?? {});
  };

  const isSuperAdmin = selectedRoleId === 'super-admin';
  const readOnly = isSuperAdmin || !can('edit');

  const toggle = (featureKey: string, action: Action) => {
    if (readOnly) return;
    setMatrix(m => ({
      ...m,
      [featureKey]: { ...m[featureKey], [action]: !m[featureKey]?.[action] },
    }));
  };

  const toggleAllForRow = (featureKey: string, actions: Action[]) => {
    if (readOnly) return;
    const allChecked = actions.every(a => matrix[featureKey]?.[a]);
    setMatrix(m => {
      const cell: Partial<Record<Action, boolean>> = { ...m[featureKey] };
      actions.forEach(a => { cell[a] = !allChecked; });
      return { ...m, [featureKey]: cell };
    });
  };

  // Column-wide toggle — checks/unchecks one action (e.g. "Lihat") straight
  // down every screen that supports it, top to bottom, in one click.
  const columnAllChecked = (a: Action) => {
    const keys = FEATURE_KEYS.filter(f => f.actions.includes(a));
    return keys.length > 0 && keys.every(f => matrix[f.key]?.[a]);
  };
  const toggleColumn = (a: Action) => {
    if (readOnly) return;
    const next = !columnAllChecked(a);
    const keys = FEATURE_KEYS.filter(f => f.actions.includes(a));
    setMatrix(m => {
      const copy = { ...m };
      keys.forEach(f => { copy[f.key] = { ...copy[f.key], [a]: next }; });
      return copy;
    });
  };

  const toggleModule = (moduleId: string) => {
    setCollapsed(s => { const n = new Set(s); n.has(moduleId) ? n.delete(moduleId) : n.add(moduleId); return n; });
  };

  // Module-scoped column toggle — same idea as toggleColumn, but limited to one
  // module's own rows (top-level menu + its children) instead of the whole matrix.
  const moduleFeatureKeys = (moduleId: string) => {
    const tops = topOf(moduleId);
    return [...tops, ...tops.flatMap(m => childOf(m.id))].map(m => m.featureKey);
  };
  const moduleColumnKeys = (moduleId: string, a: Action) =>
    moduleFeatureKeys(moduleId).filter(k => getFeatureKeyDef(k)?.actions.includes(a));
  const moduleColumnAllChecked = (moduleId: string, a: Action) => {
    const keys = moduleColumnKeys(moduleId, a);
    return keys.length > 0 && keys.every(k => matrix[k]?.[a]);
  };
  const toggleModuleColumn = (moduleId: string, a: Action) => {
    if (readOnly) return;
    const keys = moduleColumnKeys(moduleId, a);
    if (keys.length === 0) return;
    const next = !moduleColumnAllChecked(moduleId, a);
    setMatrix(m => {
      const copy = { ...m };
      keys.forEach(k => { copy[k] = { ...copy[k], [a]: next }; });
      return copy;
    });
  };

  const save = async () => {
    setSaving(true);
    const r = await fetch(`/api/role-permissions/${selectedRoleId}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: matrix }),
    });
    if (r.ok) {
      setAllPermissions(p => ({ ...p, [selectedRoleId]: matrix }));
      toast.success('Hak akses berhasil disimpan.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menyimpan hak akses.');
    }
    setSaving(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  // ── Build module → top-menu → child-menu tree, driven by Struktur Menu /
  // Modul (order, icon, grouping) — with a fallback group for any featureKey
  // whose menu was deleted, so it never silently disappears from the matrix.
  const topOf   = (moduleId: string) => menus.filter(m => m.moduleId === moduleId && !m.parentId).sort((a, b) => a.order - b.order);
  const childOf = (parentId: string) => menus.filter(m => m.parentId === parentId).sort((a, b) => a.order - b.order);
  const coveredKeys = new Set(menus.map(m => m.featureKey));
  const orphanKeys = FEATURE_KEYS.filter(f => !coveredKeys.has(f.key));

  const row = (featureKey: string, label: string, iconName: string, indent: boolean) => {
    const def = getFeatureKeyDef(featureKey);
    const actions = def?.actions ?? ['view'];
    const Icon = resolveIcon(iconName);
    const rowAllChecked = actions.every(a => isSuperAdmin || matrix[featureKey]?.[a]);
    return (
      <div key={featureKey} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
        <div className="flex-1 flex items-center gap-2 min-w-0" style={{ paddingLeft: indent ? 20 : 0 }}>
          {indent && <CornerDownRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
          <Icon size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{label}</span>
        </div>
        <div style={{ width: SELECT_COL_W, flexShrink: 0 }} className="flex items-center justify-center">
          <button
            onClick={() => toggleAllForRow(featureKey, actions)}
            disabled={readOnly || isSuperAdmin || actions.length < 2}
            title="Pilih/batal semua aksi baris ini"
            className="flex items-center justify-center disabled:opacity-20"
          >
            <CheckCheck size={14} style={{ color: rowAllChecked ? 'var(--accent)' : 'var(--text-muted)' }} />
          </button>
        </div>
        {ACTIONS.map(a => {
          if (!actions.includes(a)) return (
            <div key={a} style={{ width: ACTION_COL_W, flexShrink: 0 }} className="flex justify-center text-xs">
              <span style={{ color: 'var(--border)' }}>–</span>
            </div>
          );
          const checked = isSuperAdmin || !!matrix[featureKey]?.[a];
          return (
            <div key={a} style={{ width: ACTION_COL_W, flexShrink: 0 }} className="flex justify-center">
              <button onClick={() => toggle(featureKey, a)} disabled={readOnly} className="flex items-center justify-center disabled:cursor-default">
                <span
                  className="w-5 h-5 rounded-md flex items-center justify-center"
                  style={{ background: checked ? 'var(--accent)' : 'transparent', border: checked ? 'none' : '1.5px solid var(--border)' }}
                >
                  {checked && <Check size={11} color="#fff" strokeWidth={3.5} />}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Role selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {roles.map(r => (
          <button
            key={r.id}
            onClick={() => selectRole(r.id)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold transition-colors flex-shrink-0"
            style={selectedRoleId === r.id
              ? { background: 'var(--accent)', color: '#fff' }
              : { background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
          >
            {r.name}
          </button>
        ))}
      </div>

      {isSuperAdmin && (
        <div className="rounded-2xl px-4 py-3.5 flex items-start gap-3" style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-light)' }}>
          <ShieldAlert size={16} style={{ color: 'var(--accent-dark)', flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs font-medium" style={{ color: 'var(--accent-dark)' }}>
            Super Admin selalu memiliki akses penuh ke seluruh sistem dan tidak dapat dibatasi — ini mencegah semua akun terkunci sekaligus akibat kesalahan konfigurasi hak akses.
          </p>
        </div>
      )}

      {/* Matrix — dikelompokkan per modul & urutan ikut Struktur Menu / Modul.
          Satu wrapper scroll horizontal supaya header kolom & baris tetap
          sejajar di layar sempit, daripada aksi jadi wrap tak beraturan. */}
      <div className="overflow-x-auto thin-scrollbar">
        <div style={{ minWidth: MATRIX_MIN_WIDTH }} className="space-y-3">
          {/* Column header — centang di sini menyalakan/mematikan 1 aksi untuk semua baris dari atas ke bawah */}
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl" style={{ background: 'var(--surface-2)' }}>
            <span className="flex-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Screen</span>
            <span style={{ width: SELECT_COL_W, flexShrink: 0 }} />
            {ACTIONS.map(a => {
              const allChecked = isSuperAdmin || columnAllChecked(a);
              return (
                <div key={a} style={{ width: ACTION_COL_W, flexShrink: 0 }} className="flex justify-center">
                  <Tooltip label={`${allChecked ? 'Batal' : 'Pilih'} semua "${ACTION_LABELS[a]}"`}>
                    <button
                      onClick={() => toggleColumn(a)}
                      disabled={readOnly}
                      className="flex flex-col items-center gap-1 disabled:cursor-default"
                    >
                      <span
                        className="w-5 h-5 rounded-md flex items-center justify-center"
                        style={{ background: allChecked ? 'var(--accent)' : 'transparent', border: allChecked ? 'none' : '1.5px solid var(--border)' }}
                      >
                        {allChecked && <Check size={11} color="#fff" strokeWidth={3.5} />}
                      </span>
                      <span className="text-[9px] font-bold uppercase whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{ACTION_LABELS[a]}</span>
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>

          {modules.map(mod => {
            const tops = topOf(mod.id);
            if (tops.length === 0) return null;
            const ModIcon = resolveIcon(mod.icon);
            const isCollapsed = collapsed.has(mod.id);
            return (
              <div key={mod.id} className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                <div
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ background: 'var(--surface-2)', borderBottom: isCollapsed ? undefined : '1px solid var(--border-2)' }}
                >
                  <button onClick={() => toggleModule(mod.id)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
                    <ModIcon size={15} style={{ color: 'var(--accent)' }} />
                    <span className="text-xs font-bold uppercase tracking-wide truncate" style={{ color: 'var(--text-secondary)' }}>{mod.name}</span>
                    <ChevronDown
                      size={14}
                      style={{
                        color: 'var(--text-muted)',
                        transition: 'transform 0.15s',
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                        flexShrink: 0,
                      }}
                    />
                  </button>
                  <div style={{ width: SELECT_COL_W, flexShrink: 0 }} />
                  {ACTIONS.map(a => {
                    const keys = moduleColumnKeys(mod.id, a);
                    if (keys.length === 0) return (
                      <div key={a} style={{ width: ACTION_COL_W, flexShrink: 0 }} className="flex justify-center text-xs">
                        <span style={{ color: 'var(--border)' }}>–</span>
                      </div>
                    );
                    const checked = isSuperAdmin || moduleColumnAllChecked(mod.id, a);
                    return (
                      <div key={a} style={{ width: ACTION_COL_W, flexShrink: 0 }} className="flex justify-center">
                        <Tooltip label={`${checked ? 'Batal' : 'Pilih'} semua "${ACTION_LABELS[a]}" di modul ${mod.name}`}>
                          <button
                            onClick={() => toggleModuleColumn(mod.id, a)}
                            disabled={readOnly || isSuperAdmin}
                            className="flex items-center justify-center disabled:cursor-default"
                          >
                            <span
                              className="w-5 h-5 rounded-md flex items-center justify-center"
                              style={{ background: checked ? 'var(--accent)' : 'transparent', border: checked ? 'none' : '1.5px solid var(--border)' }}
                            >
                              {checked && <Check size={11} color="#fff" strokeWidth={3.5} />}
                            </span>
                          </button>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
                {!isCollapsed && tops.map(m => (
                  <div key={m.id}>
                    {row(m.featureKey, m.label, m.icon, false)}
                    {childOf(m.id).map(c => row(c.featureKey, c.label, c.icon, true))}
                  </div>
                ))}
              </div>
            );
          })}

          {orphanKeys.length > 0 && (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              <div className="px-4 py-3" style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-2)' }}>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Lainnya</span>
              </div>
              {orphanKeys.map(f => row(f.key, f.label, 'Package', false))}
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="card flex justify-end p-4" style={{ borderColor: 'var(--border-2)' }}>
          <button onClick={save} disabled={saving} className="btn-primary text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
            {saving ? 'Menyimpan…' : 'Simpan Hak Akses'}
          </button>
        </div>
      )}
    </div>
  );
}
