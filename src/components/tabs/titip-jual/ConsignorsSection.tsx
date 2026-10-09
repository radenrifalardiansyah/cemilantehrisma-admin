'use client';

import { useState } from 'react';
import { Users, Plus, Pencil, Trash2, Loader2, Search } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { schemeText } from '@/lib/consign';
import Pager from './Pager';
import {
  API, HEADER_BTN_H, Badge, Field, ModalShell, ModalFooter, ErrorBox, SchemeFields, usePaged,
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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<(Omit<Consignor, 'id' | 'code'> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const productCount = new Map<string, number>();
  for (const p of data.products) productCount.set(p.consignorId, (productCount.get(p.consignorId) ?? 0) + 1);

  const q = search.trim().toLowerCase();
  const filtered = data.consignors
    .filter(c => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.phone.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const { rows, safePage, totalPages } = usePaged(filtered, page, pageSize);

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/consignors${editing.id ? `/${editing.id}` : ''}`, {
      method: editing.id ? 'PUT' : 'POST', headers, body: JSON.stringify(editing),
    });
    if (r.ok) {
      await reload(); setEditing(null);
      toast.success(editing.id ? 'Penitip diperbarui.' : 'Penitip ditambahkan.');
    } else {
      setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menyimpan penitip.');
    }
    setSaving(false);
  };

  const del = async (c: Consignor) => {
    if (!await confirm({ message: `Hapus penitip "${c.name}"?`, danger: true })) return;
    setDeletingId(c.id);
    const r = await fetch(`${API}/api/consignors/${c.id}`, { method: 'DELETE', headers });
    if (r.ok) { await reload(); toast.success('Penitip dihapus.'); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menghapus penitip.');
    setDeletingId(null);
  };

  const openNew = () => { setError(''); setEditing({ ...EMPTY }); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 sm:gap-3">
        {data.consignors.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder="Cari nama, kode, atau telepon…"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        )}
        {can('create') && data.consignors.length > 0 && (
          <button onClick={openNew} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
            <Plus size={13} /> <span className="hidden sm:inline">Tambah Penitip</span>
          </button>
        )}
      </div>

      {data.consignors.length === 0 ? (
        <EmptyAddCard label="Tambah Penitip" onClick={openNew} hint="Penitip = pihak luar yang menitipkan barangnya untuk dijual di lapak kita." />
      ) : rows.length === 0 ? (
        <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada penitip yang cocok.</p></div>
      ) : (
        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
          {rows.map((c, idx) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3.5" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                  <Badge>{c.code}</Badge>
                  {!c.isActive && <Badge tone="danger">Nonaktif</Badge>}
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {[c.phone, c.bankName && `${c.bankName} ${c.bankAccount}`].filter(Boolean).join(' · ') || 'Tanpa kontak'}
                </p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Badge tone="accent">{schemeText({ scheme: c.scheme, value: c.schemeValue })}</Badge>
                  <Badge>{productCount.get(c.id) ?? 0} produk</Badge>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {can('edit') && (
                  <Tooltip label="Edit">
                    <button onClick={() => { setError(''); setEditing({ ...c }); }} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}><Pencil size={13} /></button>
                  </Tooltip>
                )}
                {can('delete') && (
                  <Tooltip label="Hapus">
                    <button onClick={() => del(c)} disabled={deletingId === c.id} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                      {deletingId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pager total={filtered.length} noun="penitip" page={safePage} totalPages={totalPages} pageSize={pageSize}
        onPage={p => setPage(Math.max(1, Math.min(p, totalPages)))} onPageSize={n => { setPageSize(n); setPage(1); }} />

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
