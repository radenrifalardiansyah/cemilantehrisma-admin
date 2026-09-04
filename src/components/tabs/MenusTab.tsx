'use client';

import { useEffect, useState } from 'react';
import { ListTree, Plus, Pencil, Trash2, X, Check, Loader2, ChevronUp, ChevronDown, EyeOff, CornerDownRight } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import IconPicker from '@/components/IconPicker';
import SearchableSelect from '@/components/SearchableSelect';
import { resolveIcon } from '@/lib/icon-registry';
import { FEATURE_KEYS } from '@/lib/permissions';
import type { ModuleDoc, MenuDoc, Action } from '@/types/rbac';

interface EditState {
  id: string; moduleId: string; parentId: string; featureKey: string; label: string; icon: string; isActive: boolean;
}
const EMPTY: EditState = { id: '', moduleId: '', parentId: '', featureKey: '', label: '', icon: 'Package', isActive: true };

interface MenusTabProps { creds: string; can: (action: Action) => boolean; onChanged?: () => void }

export default function MenusTab({ creds, can, onChanged }: MenusTabProps) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };

  const [modules, setModules] = useState<ModuleDoc[]>([]);
  const [menus,   setMenus]   = useState<MenuDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);

  const [editing,    setEditing]    = useState<EditState | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const r = await fetch('/api/menus?scope=manage', { headers });
    if (r.ok) {
      const { modules, menus } = await r.json() as { modules: ModuleDoc[]; menus: MenuDoc[] };
      setModules(modules.sort((a, b) => a.order - b.order));
      setMenus(menus);
    }
    if (!silent) setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const topOf    = (moduleId: string) => menus.filter(m => m.moduleId === moduleId && !m.parentId).sort((a, b) => a.order - b.order);
  const childOf  = (parentId: string) => menus.filter(m => m.parentId === parentId).sort((a, b) => a.order - b.order);
  const featureLabel = (key: string) => FEATURE_KEYS.find(f => f.key === key)?.label ?? key;

  // All ids nested under `id`, at any depth — used to keep a menu from being made its own descendant's child.
  // `result` doubles as the visited-set: a genuine cycle in stale/manually-edited data (parentId
  // API now rejects creating new ones, but doesn't retroactively fix existing bad data) would
  // otherwise recurse forever between the cycle's members.
  const descendantIds = (id: string): Set<string> => {
    const result = new Set<string>();
    const walk = (parentId: string) => {
      menus.filter(m => m.parentId === parentId).forEach(m => {
        if (result.has(m.id)) return;
        result.add(m.id); walk(m.id);
      });
    };
    walk(id);
    return result;
  };

  // Full menu tree of a module, flattened depth-first, for the parent-picker dropdown.
  const treeOf = (moduleId: string, excludeId?: string): { m: MenuDoc; depth: number }[] => {
    const excluded = excludeId ? new Set([excludeId, ...descendantIds(excludeId)]) : new Set<string>();
    const result: { m: MenuDoc; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      menus
        .filter(m => m.moduleId === moduleId && (m.parentId ?? null) === parentId && !excluded.has(m.id))
        .sort((a, b) => a.order - b.order)
        .forEach(m => { result.push({ m, depth }); walk(m.id, depth + 1); });
    };
    walk(null, 0);
    return result;
  };

  const openNew = (moduleId: string, parentId: string | null) => {
    const usedActive = new Set(menus.filter(m => m.isActive).map(m => m.featureKey));
    const firstFree = FEATURE_KEYS.find(f => !usedActive.has(f.key));
    setEditing({ ...EMPTY, moduleId, parentId: parentId ?? '', featureKey: firstFree?.key ?? '', label: firstFree?.label ?? '' });
    setIsNew(true); setError('');
  };
  const openEdit = (m: MenuDoc) => {
    setEditing({ id: m.id, moduleId: m.moduleId, parentId: m.parentId ?? '', featureKey: m.featureKey, label: m.label, icon: m.icon, isActive: m.isActive });
    setIsNew(false); setError('');
  };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    if (!editing.moduleId || !editing.featureKey || !editing.label.trim()) { setError('Modul, screen, dan label wajib diisi.'); return; }
    setSaving(true); setError('');

    const body = {
      moduleId: editing.moduleId, parentId: editing.parentId || null,
      featureKey: editing.featureKey, label: editing.label, icon: editing.icon, isActive: editing.isActive,
    };
    const r = isNew
      ? await fetch('/api/menus', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`/api/menus/${editing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    if (r.ok) {
      await load(true);
      onChanged?.();
      closeEdit();
      toast.success(isNew ? 'Menu berhasil ditambahkan.' : 'Menu berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal menyimpan menu.');
    }
    setSaving(false);
  };

  const del = async (m: MenuDoc) => {
    if (!await confirm({ message: `Hapus menu "${m.label}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(m.id);
    const r = await fetch(`/api/menus/${m.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load(true);
      onChanged?.();
      toast.success(`Menu "${m.label}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus menu.');
    }
    setDeletingId(null);
  };

  const move = async (siblings: MenuDoc[], idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= siblings.length) return;
    const next = siblings.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    const reordered = next.map((m, i) => ({ ...m, order: i }));
    setMenus(prev => prev.map(m => reordered.find(n => n.id === m.id) ?? m));
    setReordering(true);
    await fetch('/api/menus/reorder', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: next.map((m, i) => ({ id: m.id, order: i })) }),
    });
    await load(true);
    onChanged?.();
    setReordering(false);
  };

  const availableFeatureKeys = editing
    ? FEATURE_KEYS.filter(f => f.key === editing.featureKey || !menus.some(m => m.isActive && m.id !== editing.id && m.featureKey === f.key))
    : FEATURE_KEYS;

  const renderRow = (m: MenuDoc, siblings: MenuDoc[], idx: number, depth: number, numberLabel: string) => {
    const Icon = resolveIcon(m.icon);
    const isDeleting = deletingId === m.id;
    return (
      <div key={m.id} style={{ borderTop: '1px solid var(--border-2)', opacity: m.isActive ? 1 : 0.55 }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ paddingLeft: depth > 0 ? 16 + depth * 28 : 16 }}>
          {depth > 0 && <CornerDownRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
          <span
            className="flex-shrink-0 text-center text-[10px] font-bold tabular-nums"
            style={{ minWidth: depth > 0 ? 30 : 18, color: 'var(--text-muted)' }}
          >
            {numberLabel}
          </span>
          <div className="flex flex-col flex-shrink-0">
            <button onClick={() => move(siblings, idx, -1)} disabled={idx === 0 || reordering} className="btn-ghost p-0.5 disabled:opacity-20"><ChevronUp size={12} /></button>
            <button onClick={() => move(siblings, idx, 1)} disabled={idx === siblings.length - 1 || reordering} className="btn-ghost p-0.5 disabled:opacity-20"><ChevronDown size={12} /></button>
          </div>
          <div className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
            <Icon size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              {m.label}
              {!m.isActive && <span className="badge badge-gray flex items-center gap-1"><EyeOff size={10} /> Nonaktif</span>}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>Screen: {featureLabel(m.featureKey)}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {can('edit') && (
              <Tooltip label="Edit">
                <button onClick={() => openEdit(m)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}><Pencil size={13} /></button>
              </Tooltip>
            )}
            {can('delete') && (
              <Tooltip label="Hapus">
                <button onClick={() => del(m)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                  {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderNode = (m: MenuDoc, siblings: MenuDoc[], idx: number, depth: number, numberLabel: string) => {
    const kids = childOf(m.id);
    return (
      <div key={m.id}>
        {renderRow(m, siblings, idx, depth, numberLabel)}
        {kids.map((c, ci) => renderNode(c, kids, ci, depth + 1, `${numberLabel}.${ci + 1}`))}
      </div>
    );
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Struktur menu sidebar — label, ikon, urutan, dan pengelompokan sepenuhnya dapat diatur. Setiap menu mengarah ke satu screen aplikasi yang sudah ada.
      </p>

      {modules.map(mod => {
        const tops = topOf(mod.id);
        return (
          <div key={mod.id} className="card overflow-hidden" style={{ borderColor: 'var(--border-2)', opacity: mod.isActive ? 1 : 0.6 }}>
            <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>{mod.name}</p>
              {can('create') && (
                <button onClick={() => openNew(mod.id, null)} className="btn-ghost text-xs" style={{ height: 28 }}>
                  <Plus size={12} /> Tambah Menu
                </button>
              )}
            </div>
            {tops.length === 0 ? (
              <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada menu di modul ini.</p>
            ) : tops.map((m, idx) => renderNode(m, tops, idx, 0, `${idx + 1}`))}
          </div>
        );
      })}

      {editing && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ListTree size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Menu' : 'Edit Menu'}</p>
                  <p className="modal-subtitle">{isNew ? 'Tambahkan item menu baru' : `Edit: ${editing.label}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="field-label">Modul <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchableSelect
                    value={editing.moduleId}
                    onChange={moduleId => setEditing({ ...editing, moduleId, parentId: '' })}
                    options={modules.map(mod => ({ value: mod.id, label: mod.name }))}
                    searchPlaceholder="Cari modul…"
                  />
                </div>
                <div>
                  <label className="field-label">Sub-menu dari (opsional)</label>
                  <SearchableSelect
                    value={editing.parentId}
                    onChange={parentId => setEditing({ ...editing, parentId })}
                    options={[
                      { value: '', label: '— Menu utama —' },
                      ...treeOf(editing.moduleId, editing.id || undefined).map(({ m, depth }) => ({ value: m.id, label: m.label, depth })),
                    ]}
                    placeholder="— Menu utama —"
                    searchPlaceholder="Cari menu…"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <IconPicker value={editing.icon} onChange={icon => setEditing({ ...editing, icon })} />
                  <div className="flex-1">
                    <label className="field-label">Label <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })}
                      className="input" placeholder="cth: Pengguna" autoFocus />
                  </div>
                </div>
                <div>
                  <label className="field-label">Screen <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchableSelect
                    value={editing.featureKey}
                    onChange={key => {
                      const def = FEATURE_KEYS.find(f => f.key === key);
                      setEditing({ ...editing, featureKey: key, label: editing.label || (def?.label ?? '') });
                    }}
                    options={availableFeatureKeys.map(f => ({ value: f.key, label: f.label }))}
                    placeholder="— Pilih screen —"
                    searchPlaceholder="Cari screen…"
                  />
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Menentukan fitur & hak akses yang berlaku untuk menu ini.</p>
                </div>
                {!isNew && (
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} className="w-4 h-4" />
                    <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Tampilkan menu ini di sidebar</span>
                  </label>
                )}
                {error && (
                  <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={save} disabled={saving}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Menu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
