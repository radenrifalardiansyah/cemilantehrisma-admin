'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { schemeText } from '@/lib/consign';
import DataList, { RowActions, initials, type ExportCol } from './DataList';
import {
  API, Badge, Field, ModalShell, ModalFooter, ErrorBox, SchemeFields, deleteMany,
  type SectionProps, type Consignor,
} from './shared';

const EMPTY: Omit<Consignor, 'id' | 'code'> = {
  name: '', phone: '', address: '', bankName: '', bankAccount: '', bankHolder: '', note: '',
  scheme: 'nominal', schemeValue: 0, isActive: true,
};

export default function ConsignorsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [editing, setEditing] = useState<(Omit<Consignor, 'id' | 'code'> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const productCount = new Map<string, number>();
  for (const p of data.products) productCount.set(p.consignorId, (productCount.get(p.consignorId) ?? 0) + 1);

  const items = [...data.consignors].sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/consignors${editing.id ? `/${editing.id}` : ''}`, {
      method: editing.id ? 'PUT' : 'POST', headers, body: JSON.stringify(editing),
    });
    if (r.ok) {
      await reload(); setEditing(null);
      toast.success(editing.id ? 'Penitip berhasil diperbarui.' : 'Penitip berhasil ditambahkan.');
    } else {
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menyimpan penitip.';
      setError(msg); toast.error(msg);
    }
    setSaving(false);
  };

  const del = async (c: Consignor) => {
    if (!await confirm({ message: `Hapus penitip "${c.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(c.id);
    const r = await fetch(`${API}/api/consignors/${c.id}`, { method: 'DELETE', headers });
    if (r.ok) { await reload(); toast.success(`Penitip "${c.name}" berhasil dihapus.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menghapus penitip.');
    setDeletingId(null);
  };

  const bulkDelete = async (ids: string[]) => {
    const res = await deleteMany('/api/consignors', ids, headers);
    await reload();
    if (res.deleted > 0) toast.success(`${res.deleted} penitip berhasil dihapus.${res.failed ? ` ${res.failed} dilewati (sudah punya produk/riwayat).` : ''}`);
    else toast.error(res.firstError || 'Gagal menghapus penitip yang dipilih.');
  };

  const cols: ExportCol<Consignor>[] = [
    { header: 'Kode', width: '8%', value: c => c.code },
    { header: 'Nama', width: '16%', bold: true, value: c => c.name },
    { header: 'Telepon', width: '12%', value: c => c.phone || '-' },
    { header: 'Bagi Hasil', width: '14%', value: c => schemeText({ scheme: c.scheme, value: c.schemeValue }) },
    { header: 'Produk', width: '7%', align: 'center', value: c => productCount.get(c.id) ?? 0 },
    { header: 'Bank', width: '14%', value: c => [c.bankName, c.bankAccount].filter(Boolean).join(' ') || '-' },
    { header: 'Atas Nama', width: '12%', value: c => c.bankHolder || '-' },
    { header: 'Status', width: '8%', value: c => c.isActive ? 'Aktif' : 'Nonaktif' },
  ];

  const openNew = () => { setError(''); setEditing({ ...EMPTY }); };

  return (
    <div className="space-y-4">
      <DataList<Consignor>
        creds={creds} items={items} totalCount={data.consignors.length} getId={c => c.id} noun="penitip"
        searchText={c => `${c.name} ${c.code} ${c.phone}`} searchPlaceholder="Cari nama, kode, atau telepon…" viewKey="consign-consignors"
        addLabel={can('create') ? 'Tambah Penitip' : undefined} onAdd={can('create') ? openNew : undefined}
        emptyHint="Penitip = pihak luar yang menitipkan barangnya untuk dijual di lapak kita."
        avatar={c => initials(c.name)}
        renderBody={c => (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
              <Badge>{c.code}</Badge>
              {!c.isActive && <Badge tone="danger">Nonaktif</Badge>}
            </div>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {[c.phone, c.bankName && `${c.bankName} ${c.bankAccount}`].filter(Boolean).join(' · ') || 'Tidak ada kontak'}
            </p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge tone="accent">{schemeText({ scheme: c.scheme, value: c.schemeValue })}</Badge>
              <Badge>{productCount.get(c.id) ?? 0} produk</Badge>
            </div>
          </>
        )}
        actions={c => <RowActions onEdit={can('edit') ? () => { setError(''); setEditing({ ...c }); } : undefined}
          onDelete={can('delete') ? () => del(c) : undefined} deleting={deletingId === c.id} />}
        onBulkDelete={can('delete') ? bulkDelete : undefined}
        exportCols={cols} exportTitle="DAFTAR PENITIP" exportFile="penitip"
      />

      {editing && (
        <ModalShell title={editing.id ? 'Edit Penitip' : 'Tambah Penitip'} subtitle="Pihak luar yang menitipkan barang"
          icon={<Users size={17} />} onClose={() => setEditing(null)}
          footer={<ModalFooter onClose={() => setEditing(null)} onSave={save} saving={saving} disabled={!editing.name.trim()} label="Simpan Penitip" />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Nama Penitip" required>
              <input className="input" value={editing.name} autoFocus onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Telepon / WhatsApp (opsional)">
              <input className="input" value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} />
            </Field>
            <Field label="Alamat (opsional)">
              <input className="input" value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} />
            </Field>
            <Field label="Skema bagi hasil default" required>
              <SchemeFields scheme={editing.scheme} value={editing.schemeValue}
                onChange={(s, v) => setEditing({ ...editing, scheme: s ?? 'nominal', schemeValue: v ?? 0 })} />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Berlaku untuk semua produk penitip ini, kecuali produk/lapak punya skema sendiri.
              </p>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Bank"><input className="input" value={editing.bankName} placeholder="BCA / BRI…" onChange={e => setEditing({ ...editing, bankName: e.target.value })} /></Field>
              <Field label="No. Rekening"><input className="input" value={editing.bankAccount} onChange={e => setEditing({ ...editing, bankAccount: e.target.value })} /></Field>
              <Field label="Atas Nama"><input className="input" value={editing.bankHolder} onChange={e => setEditing({ ...editing, bankHolder: e.target.value })} /></Field>
            </div>
            <Field label="Catatan (opsional)">
              <textarea className="input" style={{ resize: 'vertical', minHeight: 60 }} value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} />
              Penitip aktif
            </label>
            <ErrorBox message={error} />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
