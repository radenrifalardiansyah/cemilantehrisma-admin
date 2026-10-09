'use client';

import { useState, useEffect, useCallback } from 'react';
import { Store, Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import DataList, { RowActions, DetailPanel, initials, type ExportCol } from './DataList';
import {
  API, Badge, Field, ModalShell, ModalFooter, ErrorBox, deleteMany, rupiah,
  type SectionProps, type Stall,
} from './shared';

type StallForm = Omit<Stall, 'id' | 'code' | 'balance'> & { id?: string; openingBalance: string };

const EMPTY: StallForm = { name: '', address: '', warehouseId: '', note: '', isActive: true, invoicePrefix: '', usernames: [], showOwnProducts: false, openingBalance: '' };

const KIND_LABEL: Record<string, string> = { opening: 'Saldo awal', manual: 'Manual', sale: 'Penjualan', payout: 'Bayar penitip' };

interface WalletEntry { id: string; kind: string; amount: number; note: string; createdBy: string; createdAt: { seconds: number } | null }

export default function StallsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [editing, setEditing] = useState<StallForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [walletFor, setWalletFor] = useState<Stall | null>(null);
  const [staffSearch, setStaffSearch] = useState('');

  const stockByStall = new Map<string, number>();
  for (const i of data.stallItems) stockByStall.set(i.stallId, (stockByStall.get(i.stallId) ?? 0) + i.stockQty);
  const staffByName = new Map(data.staff.map(u => [u.username, u]));
  const staffLabel = (u: string) => staffByName.get(u)?.fullName || u;

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
    if (res.deleted > 0) toast.success(`${res.deleted} lapak berhasil dihapus.${res.failed ? ` ${res.failed} dilewati (sudah punya data titipan/riwayat).` : ''}`);
    else toast.error(res.firstError || 'Gagal menghapus lapak yang dipilih.');
  };

  const items = [...data.stalls].sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const whName = (id: string) => data.warehouses.find(w => w.id === id)?.name ?? '';
  const cols: ExportCol<Stall>[] = [
    { header: 'Kode', width: '8%', value: s => s.code },
    { header: 'Nama', width: '16%', bold: true, value: s => s.name },
    { header: 'Awalan Invoice', width: '11%', value: s => s.invoicePrefix },
    { header: 'Alamat', width: '20%', value: s => s.address || '-' },
    { header: 'Gudang', width: '12%', value: s => whName(s.warehouseId) || '-' },
    { header: 'Petugas', width: '15%', value: s => s.usernames.map(staffLabel).join(', ') || '-' },
    { header: 'Saldo Dompet', width: '11%', align: 'right', value: s => rupiah(s.balance) },
    { header: 'Status', width: '7%', value: s => s.isActive ? 'Aktif' : 'Nonaktif' },
  ];

  const openNew = () => { setError(''); setStaffSearch(''); setEditing({ ...EMPTY }); };
  const openEdit = (s: Stall) => {
    setError(''); setStaffSearch('');
    setEditing({ id: s.id, name: s.name, address: s.address, warehouseId: s.warehouseId, note: s.note, isActive: s.isActive, invoicePrefix: s.invoicePrefix, usernames: s.usernames, showOwnProducts: s.showOwnProducts, openingBalance: '' });
  };

  const q = staffSearch.trim().toLowerCase();
  const staffShown = data.staff.filter(u => !q || u.username.includes(q) || u.fullName.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <DataList<Stall>
        creds={creds} items={items} totalCount={data.stalls.length} getId={s => s.id} noun="lapak"
        searchText={s => `${s.name} ${s.code} ${s.address} ${s.usernames.join(' ')}`} searchPlaceholder="Cari nama, kode, alamat, atau petugas…" viewKey="consign-stalls"
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
              <Badge tone="ok">Dompet: {rupiah(s.balance)}</Badge>
              <Badge>{s.usernames.length} petugas</Badge>
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
              { label: 'Awalan Invoice', value: <span className="font-mono">{s.invoicePrefix}-YYYYMM-0001</span> },
              { label: 'Gudang Terkait', value: whName(s.warehouseId) },
              { label: 'Stok Titipan', value: (stockByStall.get(s.id) ?? 0).toLocaleString('id-ID') },
              { label: 'Produk Dijual', value: `${its.length} produk (${its.filter(i => i.stockQty > 0).length} ada stok)` },
              { label: 'Produk toko di Kasir Lapak', value: s.showOwnProducts && s.warehouseId ? 'Ditampilkan' : 'Tidak ditampilkan' },
              { label: 'Saldo Dompet Lapak', value: rupiah(s.balance) },
              { label: 'Petugas', value: s.usernames.length ? s.usernames.map(staffLabel).join(', ') : '' },
              { label: 'Alamat', value: s.address, wide: true },
              ...(s.note ? [{ label: 'Catatan', value: s.note, wide: true }] : []),
            ]}>
              <button onClick={() => setWalletFor(s)} className="btn-ghost text-xs"><Wallet size={13} /> Dompet &amp; Riwayat Kas</button>
            </DetailPanel>
          );
        }}
        actions={s => <RowActions onEdit={can('edit') ? () => openEdit(s) : undefined}
          onDelete={can('delete') ? () => del(s) : undefined} deleting={deletingId === s.id} />}
        onBulkDelete={can('delete') ? bulkDelete : undefined}
        exportCols={cols} exportTitle="DAFTAR LAPAK" exportFile="lapak"
      />

      {editing && (
        <ModalShell title={editing.id ? 'Edit Lapak' : 'Tambah Lapak'} subtitle="Tempat barang titipan dijual" size="modal-md"
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
            {editing.warehouseId && (
              <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" className="mt-0.5" checked={editing.showOwnProducts} onChange={e => setEditing({ ...editing, showOwnProducts: e.target.checked })} />
                <span>
                  Jual juga produk toko dari gudang ini di Kasir Lapak
                  <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Kalau dicentang, semua produk toko yang ada stoknya di gudang terkait tampil di Kasir Lapak. Kosongkan kalau lapak ini hanya menjual barang titipan.
                  </span>
                </span>
              </label>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Awalan nomor invoice">
                <input className="input font-mono" value={editing.invoicePrefix} maxLength={12} placeholder="otomatis dari kode lapak"
                  onChange={e => setEditing({ ...editing, invoicePrefix: e.target.value.toUpperCase() })} />
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Contoh nota: {(editing.invoicePrefix || 'LPK001')}-{new Date().toISOString().slice(0, 7).replace('-', '')}-0001
                </p>
              </Field>
              {!editing.id && (
                <Field label="Saldo awal dompet lapak (Rp)">
                  <NumberInput value={editing.openingBalance} placeholder="0" onChange={raw => setEditing({ ...editing, openingBalance: raw })} />
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Kas awal/modal di lapak. Bisa diisi 0.</p>
                </Field>
              )}
            </div>

            <div>
              <p className="field-label">Petugas lapak</p>
              {data.staff.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Belum ada akun yang bisa ditugaskan. Buat akun (dengan role Kasir Lapak) di menu Pengguna terlebih dahulu.
                </p>
              ) : (
                <div className="card" style={{ padding: 8 }}>
                  <input className="input text-xs" style={{ marginBottom: 6 }} placeholder="Cari akun…" value={staffSearch} onChange={e => setStaffSearch(e.target.value)} />
                  <div className="thin-scrollbar" style={{ maxHeight: 180, overflowY: 'auto' }}>
                    {staffShown.length === 0 && <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>Tidak ditemukan</p>}
                    {staffShown.map(u => {
                      const on = editing.usernames.includes(u.username);
                      return (
                        <label key={u.username} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer" style={{ background: on ? 'var(--accent-bg)' : undefined }}>
                          <input type="checkbox" checked={on}
                            onChange={() => setEditing({ ...editing, usernames: on ? editing.usernames.filter(x => x !== u.username) : [...editing.usernames, u.username] })} />
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{u.fullName || u.username}</span>
                          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>@{u.username} · {u.role}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Petugas hanya bisa membuka Kasir Lapak untuk lapak yang ditugaskan padanya. Admin selalu bisa semua lapak.
              </p>
            </div>

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

      {walletFor && (
        <WalletModal creds={creds} stall={walletFor} canEdit={can('edit')} onClose={() => setWalletFor(null)} onChanged={reload} />
      )}
    </div>
  );
}

async function fetchWallet(creds: string, id: string): Promise<{ balance: number; entries: WalletEntry[] }> {
  const r = await fetch(`${API}/api/stalls/${id}/wallet`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as { balance: number; entries: WalletEntry[] } : { balance: 0, entries: [] };
}

// Dompet lapak: saldo, riwayat kas, dan entri manual (tambah modal / ambil kas).
function WalletModal({ creds, stall, canEdit, onClose, onChanged }: { creds: string; stall: Stall; canEdit: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [wallet, setWallet] = useState<{ balance: number; entries: WalletEntry[] } | null>(null);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => { setWallet(await fetchWallet(creds, stall.id)); }, [creds, stall.id]);
  useEffect(() => {
    let alive = true;
    fetchWallet(creds, stall.id).then(d => { if (alive) setWallet(d); });
    return () => { alive = false; };
  }, [creds, stall.id]);

  const submit = async () => {
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/stalls/${stall.id}/wallet`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, amount: Number(amount), note }),
    });
    if (r.ok) {
      setAmount(''); setNote('');
      await Promise.all([load(), onChanged()]);
      toast.success('Entri kas dicatat.');
    } else {
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal mencatat entri.';
      setError(msg); toast.error(msg);
    }
    setSaving(false);
  };

  return (
    <ModalShell title="Dompet Lapak" subtitle={stall.name} icon={<Wallet size={17} />} onClose={onClose} size="modal-md"
      footer={<button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>}>
      {wallet === null ? <PageLoader /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Saldo dompet</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{rupiah(wallet.balance)}</p>
          </div>

          {canEdit && (
            <div className="card p-3" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="flex gap-2">
                {([['in', 'Tambah kas', ArrowDownLeft], ['out', 'Ambil kas', ArrowUpRight]] as const).map(([d, label, Icon]) => (
                  <button key={d} onClick={() => setDirection(d)} className="flex-1 px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                    style={direction === d ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
              <NumberInput value={amount} placeholder="Jumlah (Rp)" onChange={setAmount} />
              <input className="input" value={note} maxLength={200} placeholder={direction === 'in' ? 'Keterangan, cth: modal awal minggu ini' : 'Keterangan, cth: setor ke toko'}
                onChange={e => setNote(e.target.value)} />
              <ErrorBox message={error} />
              <button onClick={submit} disabled={saving || !(Number(amount) > 0) || !note.trim()} className="btn-primary text-xs" style={{ justifyContent: 'center' }}>
                {saving ? 'Menyimpan…' : 'Catat'}
              </button>
            </div>
          )}

          <div>
            <p className="field-label">Riwayat kas</p>
            {wallet.entries.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Belum ada entri kas.</p>
            ) : wallet.entries.map((e, idx) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2.5" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{KIND_LABEL[e.kind] ?? e.kind}{e.note ? ` · ${e.note}` : ''}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {e.createdAt ? new Date(e.createdAt.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    {e.createdBy ? ` · ${e.createdBy}` : ''}
                  </p>
                </div>
                <p className="text-sm font-bold flex-shrink-0" style={{ color: e.amount >= 0 ? '#059669' : 'var(--danger)' }}>{e.amount >= 0 ? '+' : '-'}{rupiah(Math.abs(e.amount))}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
