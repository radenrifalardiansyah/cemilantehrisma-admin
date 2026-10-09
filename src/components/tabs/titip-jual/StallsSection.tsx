'use client';

import { useState, useEffect } from 'react';
import { Store, Wallet } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { periodRange, type PeriodKey } from '@/lib/period';
import PeriodBar from './PeriodBar';
import DataList, { RowActions, DetailPanel, initials, type ExportCol } from './DataList';
import {
  API, Badge, Field, ModalShell, ModalFooter, ErrorBox, deleteMany, rupiah, qtyText, effectiveFor,
  type SectionProps, type Stall,
} from './shared';

type StallForm = Omit<Stall, 'id' | 'code' | 'balance'> & { id?: string; openingBalance: string };

const EMPTY: StallForm = { name: '', address: '', warehouseId: '', note: '', isActive: true, invoicePrefix: '', usernames: [], showOwnProducts: false, openingBalance: '' };


interface StallStats { count: number; revenue: number; discount: number; itemsSold: number; ownRevenue: number; consignorShare: number; ourConsign: number; storeShare: number }
const EMPTY_STATS: StallStats = { count: 0, revenue: 0, discount: 0, itemsSold: 0, ownRevenue: 0, consignorShare: 0, ourConsign: 0, storeShare: 0 };

async function fetchStats(creds: string, from: string, to: string): Promise<Record<string, StallStats>> {
  const r = await fetch(`${API}/api/consign/stall-stats?from=${from}&to=${to}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? ((await r.json()) as { stats: Record<string, StallStats> }).stats : {};
}

const TILE_LABEL = 'text-[9px] font-semibold uppercase leading-tight whitespace-nowrap overflow-hidden text-ellipsis';
const TILE_VALUE = 'text-xs font-bold tabular leading-tight mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis';
const TILE_NOTE = 'text-[10px] tabular leading-tight whitespace-nowrap overflow-hidden text-ellipsis';

function Tile({ title, main, note, bg, color }: { title: string; main: string; note?: string; bg?: string; color?: string }) {
  return (
    <div className="flex flex-col justify-between px-3 py-2 rounded-lg min-h-[52px] min-w-0" style={{ background: bg ?? 'var(--surface-2)' }}>
      <p className={TILE_LABEL} style={{ color: 'var(--text-muted)' }}>{title}</p>
      <div className="min-w-0">
        <p className={TILE_VALUE} style={{ color: color ?? 'var(--text-primary)' }}>{main}</p>
        {note && <p className={TILE_NOTE} style={{ color: 'var(--text-muted)' }}>{note}</p>}
      </div>
    </div>
  );
}

// Ringkasan per lapak (gaya sama dengan kotak statistik lokasi di Mitra): stok & jumlah produk saat
// ini, lalu pendapatan/transaksi/bagi hasil pada periode yang dipilih.
// `dense`: tampilan kartu (kolom sempit) → maksimal 3 kolom supaya label tidak terpotong.
function StallStatTiles({ stockQty, stockValue, products, productsInStock, stats, dense }: {
  stockQty: number; stockValue: number; products: number; productsInStock: number; stats: StallStats; dense: boolean;
}) {
  return (
    <div className={dense ? 'grid grid-cols-2 sm:grid-cols-3 gap-1.5' : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5'}>
      <Tile title="Stok Saat Ini" main={`${qtyText(stockQty)} pcs`} note={rupiah(stockValue)} bg={stockQty > 0 ? 'var(--success-bg)' : undefined} color={stockQty > 0 ? 'var(--success)' : 'var(--text-muted)'} />
      <Tile title="Total Produk" main={`${products} produk`} note={`${productsInStock} ada stok`} />
      <Tile title="Pendapatan" main={rupiah(stats.revenue)} bg={stats.revenue > 0 ? 'var(--success-bg)' : undefined} color={stats.revenue > 0 ? 'var(--success)' : 'var(--text-muted)'} />
      <Tile title="Transaksi" main={`${stats.count}`} note={`${qtyText(stats.itemsSold)} barang terjual`} />
      <Tile title="Bagian Toko" main={rupiah(stats.storeShare)} />
      <Tile title="Bagian Penitip" main={rupiah(stats.consignorShare)} />
    </div>
  );
}

export default function StallsSection({ creds, data, reload, can, openJournal }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [editing, setEditing] = useState<StallForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [customTo, setCustomTo] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [stats, setStats] = useState<Record<string, StallStats>>({});
  const { from, to } = periodRange(period, customFrom, customTo);

  useEffect(() => {
    let alive = true;
    fetchStats(creds, from, to).then(d => { if (alive) setStats(d); });
    return () => { alive = false; };
  }, [creds, from, to, data.stalls.length]);
  const statsOf = (id: string): StallStats => stats[id] ?? EMPTY_STATS;

  const stockByStall = new Map<string, number>();
  for (const i of data.stallItems) stockByStall.set(i.stallId, (stockByStall.get(i.stallId) ?? 0) + i.stockQty);
  const consignorById = new Map(data.consignors.map(c => [c.id, c]));
  const productById = new Map(data.products.map(p => [p.id, p]));
  const stockInfo = (stallId: string) => {
    let qty = 0, value = 0, inStock = 0, products = 0;
    for (const i of data.stallItems) {
      if (i.stallId !== stallId) continue;
      const p = productById.get(i.productId);
      if (!p) continue;
      products++;
      if (i.stockQty > 0) { inStock++; qty += i.stockQty; value += i.stockQty * effectiveFor(p, consignorById.get(p.consignorId), i).price; }
    }
    return { qty, value, inStock, products };
  };
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
    { header: 'Alamat', width: '14%', value: s => s.address || '-' },
    { header: 'Gudang', width: '12%', value: s => whName(s.warehouseId) || '-' },
    { header: 'Petugas', width: '11%', value: s => s.usernames.map(staffLabel).join(', ') || '-' },
    { header: 'Saldo Dompet', width: '11%', align: 'right', value: s => rupiah(s.balance) },
    { header: 'Pendapatan Periode', width: '12%', align: 'right', value: s => rupiah(statsOf(s.id).revenue) },
    { header: 'Transaksi', width: '8%', align: 'right', value: s => statsOf(s.id).count },
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
      {data.stalls.length > 0 && <PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} />}
      <DataList<Stall>
        creds={creds} items={items} totalCount={data.stalls.length} getId={s => s.id} noun="lapak"
        searchText={s => `${s.name} ${s.code} ${s.address} ${s.usernames.join(' ')}`} searchPlaceholder="Cari nama, kode, alamat, atau petugas…" viewKey="consign-stalls"
        addLabel={can('create') ? 'Tambah Lapak' : undefined} onAdd={can('create') ? openNew : undefined}
        emptyHint="Lapak = tempat barang titipan dijual (lapak 1, 2, 3, dst)."
        avatar={s => initials(s.name)}
        renderBody={(s, view) => {
          const info = stockInfo(s.id);
          return (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                <Badge>{s.code}</Badge>
                {!s.isActive && <Badge tone="danger">Nonaktif</Badge>}
              </div>
              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{s.address || 'Tanpa alamat'}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Badge tone="ok">Dompet: {rupiah(s.balance)}</Badge>
                <Badge>{s.usernames.length} petugas</Badge>
                {whName(s.warehouseId) && <Badge>Gudang: {whName(s.warehouseId)}</Badge>}
              </div>
              <div className="mt-2.5">
                <StallStatTiles stockQty={info.qty} stockValue={info.value} products={info.products} productsInStock={info.inStock} stats={statsOf(s.id)} dense={view === 'card'} />
              </div>
            </>
          );
        }}
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
              <button onClick={() => openJournal?.(s.id)} className="btn-ghost text-xs"><Wallet size={13} /> Jurnal Kas Lapak</button>
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

    </div>
  );
}
