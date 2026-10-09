'use client';

import { useState } from 'react';
import { Store } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import DataList, { RowActions, DetailPanel, initials, type ExportCol } from './DataList';
import { API, Badge, Field, ModalShell, ModalFooter, ErrorBox, deleteMany, type SectionProps, type Stall } from './shared';

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
      toast.success(editing.id ? 'Lapak berhasil diperbarui.' : 'Lapak berhasil ditambahkan.');
    } else {
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menyimpan lapak.';
      setError(msg); toast.error(msg);
    }
    setSaving(false);
  };

  const del = async (s: Stall) => {
    if (!await confirm({ message: `Hapus lapak "${s.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(s.id);
    const r = await fetch(`${API}/api/stalls/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) { await reload(); toast.success(`Lapak "${s.name}" berhasil dihapus.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menghapus lapak.');
    setDeletingId(null);
  };

  const bulkDelete = async (ids: string[]) => {
    const res = await deleteMany('/api/stalls', ids, headers);
    await reload();
    if (res.deleted > 0) toast.success(`${res.deleted} lapak berhasil dihapus.${res.failed ? ` ${res.failed} dilewati (sudah punya data titipan).` : ''}`);
    else toast.error(res.firstError || 'Gagal menghapus lapak yang dipilih.');
  };

  const items = [...data.stalls].sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const whName = (id: string) => data.warehouses.find(w => w.id === id)?.name ?? '';
  const cols: ExportCol<Stall>[] = [
    { header: 'Kode', width: '9%', value: s => s.code },
    { header: 'Nama', width: '20%', bold: true, value: s => s.name },
    { header: 'Alamat', width: '28%', value: s => s.address || '-' },
    { header: 'Gudang', width: '15%', value: s => whName(s.warehouseId) || '-' },
    { header: 'Stok Titipan', width: '12%', align: 'right', value: s => stockByStall.get(s.id) ?? 0 },
    { header: 'Status', width: '10%', value: s => s.isActive ? 'Aktif' : 'Nonaktif' },
  ];

  const openNew = () => { setError(''); setEditing({ ...EMPTY }); };

  return (
    <div className="space-y-4">
      <DataList<Stall>
        creds={creds} items={items} totalCount={data.stalls.length} getId={s => s.id} noun="lapak"
        searchText={s => `${s.name} ${s.code} ${s.address}`} searchPlaceholder="Cari nama, kode, atau alamat…" viewKey="consign-stalls"
        addLabel={can('create') ? 'Tambah Lapak' : undefined} onAdd={can('create') ? openNew : undefined}
        emptyHint="Lapak = tempat barang titipan dijual (lapak 1, 2, 3, dst)."
        avatar={s => initials(s.name)}
        renderBody={s => (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
              <Badge>{s.code}</Badge>
              {!s.isActive && <Badge tone="danger">Nonaktif</Badge>}
            </div>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{s.address || 'Tanpa alamat'}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge tone="accent">Stok titipan: {(stockByStall.get(s.id) ?? 0).toLocaleString('id-ID')}</Badge>
              {whName(s.warehouseId) && <Badge>Gudang: {whName(s.warehouseId)}</Badge>}
            </div>
          </>
        )}
        renderDetail={s => {
          const its = data.stallItems.filter(i => i.stallId === s.id);
          return (
            <DetailPanel fields={[
              { label: 'Kode Lapak', value: s.code },
              { label: 'Status', value: s.isActive ? 'Aktif' : 'Nonaktif' },
              { label: 'Gudang Terkait', value: whName(s.warehouseId) },
              { label: 'Stok Titipan', value: (stockByStall.get(s.id) ?? 0).toLocaleString('id-ID') },
              { label: 'Produk Dijual', value: `${its.length} produk (${its.filter(i => i.stockQty > 0).length} ada stok)` },
              { label: 'Alamat', value: s.address, wide: true },
              ...(s.note ? [{ label: 'Catatan', value: s.note, wide: true }] : []),
            ]} />
          );
        }}
        actions={s => <RowActions onEdit={can('edit') ? () => { setError(''); setEditing({ ...s }); } : undefined}
          onDelete={can('delete') ? () => del(s) : undefined} deleting={deletingId === s.id} />}
        onBulkDelete={can('delete') ? bulkDelete : undefined}
        exportCols={cols} exportTitle="DAFTAR LAPAK" exportFile="lapak"
      />

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
              <SearchSelect value={editing.warehouseId} onChange={v => setEditing({ ...editing, warehouseId: v })}
                options={[{ value: '', label: '— Tanpa gudang —' }, ...data.warehouses.map(w => ({ value: w.id, label: w.name }))]}
                placeholder="– Pilih gudang –" searchPlaceholder="Cari gudang…" />
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
