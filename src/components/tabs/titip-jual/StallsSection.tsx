'use client';

import { useState } from 'react';
import { Store, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { API, HEADER_BTN_H, Badge, Field, ModalShell, ModalFooter, ErrorBox, type SectionProps, type Stall } from './shared';

const EMPTY: Omit<Stall, 'id' | 'code'> = { name: '', address: '', warehouseId: '', note: '', isActive: true };

export default function StallsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [editing, setEditing] = useState<(Omit<Stall, 'id' | 'code'> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const stockByStall = new Map<string, number>();
  for (const i of data.stallItems) stockByStall.set(i.stallId, (stockByStall.get(i.stallId) ?? 0) + i.stockQty);

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/stalls${editing.id ? `/${editing.id}` : ''}`, {
      method: editing.id ? 'PUT' : 'POST', headers, body: JSON.stringify(editing),
    });
    if (r.ok) {
      await reload(); setEditing(null);
      toast.success(editing.id ? 'Lapak diperbarui.' : 'Lapak ditambahkan.');
    } else {
      setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menyimpan lapak.');
    }
    setSaving(false);
  };

  const del = async (s: Stall) => {
    if (!await confirm({ message: `Hapus lapak "${s.name}"?`, danger: true })) return;
    setDeletingId(s.id);
    const r = await fetch(`${API}/api/stalls/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) { await reload(); toast.success('Lapak dihapus.'); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menghapus lapak.');
    setDeletingId(null);
  };

  const openNew = () => { setError(''); setEditing({ ...EMPTY }); };

  return (
    <div className="space-y-4">
      {can('create') && data.stalls.length > 0 && (
        <div className="flex justify-end">
          <button onClick={openNew} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
            <Plus size={13} /> <span className="hidden sm:inline">Tambah Lapak</span>
          </button>
        </div>
      )}

      {data.stalls.length === 0 ? (
        <EmptyAddCard label="Tambah Lapak" onClick={openNew} hint="Lapak = tempat barang titipan dijual (lapak 1, 2, 3, dst)." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.stalls.map(s => {
            const wh = data.warehouses.find(w => w.id === s.warehouseId);
            return (
              <div key={s.id} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                      <Badge>{s.code}</Badge>
                      {!s.isActive && <Badge tone="danger">Nonaktif</Badge>}
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.address || 'Tanpa alamat'}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {can('edit') && (
                      <Tooltip label="Edit">
                        <button onClick={() => { setError(''); setEditing({ ...s }); }} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}><Pencil size={13} /></button>
                      </Tooltip>
                    )}
                    {can('delete') && (
                      <Tooltip label="Hapus">
                        <button onClick={() => del(s)} disabled={deletingId === s.id} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                          {deletingId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge tone="accent">Stok titipan: {(stockByStall.get(s.id) ?? 0).toLocaleString('id-ID')}</Badge>
                  {wh && <Badge>Gudang: {wh.name}</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ModalShell title={editing.id ? 'Edit Lapak' : 'Tambah Lapak'} subtitle="Tempat barang titipan dijual"
          icon={<Store size={17} />} onClose={() => setEditing(null)}
          footer={<ModalFooter onClose={() => setEditing(null)} onSave={save} saving={saving} disabled={!editing.name.trim()} label="Simpan Lapak" />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Nama Lapak" required>
              <input className="input" value={editing.name} autoFocus placeholder="cth: Lapak 1"
                onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Alamat (opsional)">
              <input className="input" value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} />
            </Field>
            <Field label="Gudang terkait (opsional)">
              <select className="input" value={editing.warehouseId} onChange={e => setEditing({ ...editing, warehouseId: e.target.value })}>
                <option value="">— Tanpa gudang —</option>
                {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Catatan (opsional)">
              <textarea className="input" style={{ resize: 'vertical', minHeight: 60 }} value={editing.note}
                onChange={e => setEditing({ ...editing, note: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} />
              Lapak aktif
            </label>
            <ErrorBox message={error} />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
