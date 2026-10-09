'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import FilterSelect from '@/components/FilterSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { schemeText, type ShareScheme } from '@/lib/consign';
import DataList, { RowActions, initials, type ExportCol } from './DataList';
import { downloadTemplate, readRows, type ImportCol } from './importers';
import {
  API, Badge, Field, ModalShell, ModalFooter, ErrorBox, SchemeFields, deleteMany, reportImport, rupiah, qtyText, effectiveFor,
  type SectionProps, type CProduct,
} from './shared';

const IMPORT_COLS: ImportCol[] = [
  { header: 'Penitip* (nama/kode)', key: 'consignor', width: 24, aliases: ['penitip', 'namapenitip', 'kodepenitip'], required: true },
  { header: 'Nama Produk*', key: 'name', width: 26, aliases: ['namaproduk', 'produk', 'nama'], required: true },
  { header: 'Satuan', key: 'unit', width: 10, aliases: ['satuan', 'unit'] },
  { header: 'Harga Jual*', key: 'price', width: 14, aliases: ['hargajual', 'harga', 'hargajualdefault'], required: true },
  { header: 'Skema (Nominal/Komisi)', key: 'scheme', width: 22, aliases: ['skema', 'skemabagihasil'] },
  { header: 'Nilai (Rp setor atau % komisi)', key: 'value', width: 28, aliases: ['nilai', 'nilaibagihasil'] },
  { header: 'Lapak (pisahkan dengan koma)', key: 'stalls', width: 28, aliases: ['lapak', 'dijualdilapak'] },
  { header: 'Catatan', key: 'note', width: 28, aliases: ['catatan', 'note'] },
];

interface StallCfg { enabled: boolean; price: string; scheme: ShareScheme | null; schemeValue: number | null }
interface Form {
  id?: string; consignorId: string; name: string; unit: string; defaultPrice: string;
  scheme: ShareScheme | null; schemeValue: number | null; note: string; isActive: boolean;
  stalls: Record<string, StallCfg>;
}

export default function ProductsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [consignorFilter, setConsignorFilter] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [editing, setEditing] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const consignorById = new Map(data.consignors.map(c => [c.id, c]));
  const stallById = new Map(data.stalls.map(s => [s.id, s]));
  const itemsByProduct = new Map<string, typeof data.stallItems>();
  for (const i of data.stallItems) {
    const arr = itemsByProduct.get(i.productId) ?? [];
    arr.push(i); itemsByProduct.set(i.productId, arr);
  }

  const items = data.products
    .filter(p => !consignorFilter || p.consignorId === consignorFilter)
    .filter(p => !stallFilter || (itemsByProduct.get(p.id) ?? []).some(i => i.stallId === stallFilter))
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));

  const blankStalls = (): Record<string, StallCfg> =>
    Object.fromEntries(data.stalls.map(s => [s.id, { enabled: false, price: '', scheme: null, schemeValue: null }]));

  const openNew = () => {
    setError('');
    setEditing({
      consignorId: consignorFilter || '', name: '', unit: 'pcs', defaultPrice: '', scheme: null, schemeValue: null,
      note: '', isActive: true, stalls: blankStalls(),
    });
  };
  const openEdit = (p: CProduct) => {
    setError('');
    const stalls = blankStalls();
    for (const i of itemsByProduct.get(p.id) ?? []) {
      stalls[i.stallId] = { enabled: true, price: i.price === null ? '' : String(i.price), scheme: i.scheme, schemeValue: i.schemeValue };
    }
    setEditing({
      id: p.id, consignorId: p.consignorId, name: p.name, unit: p.unit, defaultPrice: String(p.defaultPrice),
      scheme: p.scheme, schemeValue: p.schemeValue, note: p.note, isActive: p.isActive, stalls,
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    const body = {
      consignorId: editing.consignorId, name: editing.name, unit: editing.unit, defaultPrice: Number(editing.defaultPrice || 0),
      scheme: editing.scheme, schemeValue: editing.schemeValue, note: editing.note, isActive: editing.isActive,
      stallItems: Object.entries(editing.stalls).filter(([, c]) => c.enabled).map(([stallId, c]) => ({
        stallId, price: c.price === '' ? null : Number(c.price), scheme: c.scheme, schemeValue: c.schemeValue,
      })),
    };
    const r = await fetch(`${API}/api/consign/products${editing.id ? `/${editing.id}` : ''}`, {
      method: editing.id ? 'PUT' : 'POST', headers, body: JSON.stringify(body),
    });
    if (r.ok) {
      await reload(); setEditing(null);
      toast.success(editing.id ? 'Produk berhasil diperbarui.' : 'Produk titipan berhasil ditambahkan.');
    } else {
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menyimpan produk.';
      setError(msg); toast.error(msg);
    }
    setSaving(false);
  };

  const del = async (p: CProduct) => {
    if (!await confirm({ message: `Hapus produk titipan "${p.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(p.id);
    const r = await fetch(`${API}/api/consign/products/${p.id}`, { method: 'DELETE', headers });
    if (r.ok) { await reload(); toast.success(`Produk "${p.name}" berhasil dihapus.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menghapus produk.');
    setDeletingId(null);
  };

  const bulkDelete = async (ids: string[]) => {
    const res = await deleteMany('/api/consign/products', ids, headers);
    await reload();
    if (res.deleted > 0) toast.success(`${res.deleted} produk berhasil dihapus.${res.failed ? ` ${res.failed} dilewati (sudah punya stok/riwayat).` : ''}`);
    else toast.error(res.firstError || 'Gagal menghapus produk yang dipilih.');
  };

  const setStall = (stallId: string, patch: Partial<StallCfg>) =>
    setEditing(e => e && ({ ...e, stalls: { ...e.stalls, [stallId]: { ...e.stalls[stallId], ...patch } } }));

  const editConsignor = editing ? consignorById.get(editing.consignorId) : undefined;
  const editPrice = Number(editing?.defaultPrice) || 0;

  const importer = can('create') ? {
    onTemplate: () => downloadTemplate({
      sheet: 'Template Produk Titipan', title: 'TEMPLATE IMPORT PRODUK TITIP JUAL — CEMILAN TEH RISMA', file: 'template-produk-titip-jual.xlsx',
      note: 'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3; isi data mulai baris 4, satu produk per baris. '
        + 'Penitip dan Lapak harus sudah terdaftar (tulis nama atau kodenya). Skema kosong = ikut skema default penitip; atau isi "Nominal"/"Komisi" beserta nilainya. '
        + 'Lapak boleh lebih dari satu, pisahkan dengan koma (cth: Lapak 1, Lapak 2). Stok awal dicatat lewat tab Terima & Retur. Produk yang sudah ada dilewati.',
      cols: IMPORT_COLS,
      example: { consignor: 'Bu Sari Kue Kering', name: 'Nastar 250gr', unit: 'toples', price: '35000', scheme: 'Nominal', value: '28000', stalls: 'Lapak 1, Lapak 2', note: 'Contoh — timpa dengan data produk Anda' },
    }),
    onFile: async (file: File) => {
      try {
        const parsed = await readRows(file, IMPORT_COLS);
        if ('error' in parsed) { toast.error(parsed.error); return; }
        const rows = parsed.rows.filter(r => r.name.trim() || r.consignor.trim());
        if (rows.length === 0) { toast.error('Tidak ada data produk valid pada file tersebut.'); return; }
        const r = await fetch(`${API}/api/consign/products/bulk-import`, { method: 'POST', headers, body: JSON.stringify({ products: rows }) });
        const d = await r.json().catch(() => ({})) as { error?: string; created: number; skippedDuplicate: number; errors: string[]; errorCount: number };
        if (!r.ok) { toast.error(d.error ?? 'Gagal mengimpor produk titipan.'); return; }
        await reload();
        reportImport(toast, 'produk', d);
      } catch {
        toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
      }
    },
  } : undefined;

  const stallSummary = (p: CProduct) => (itemsByProduct.get(p.id) ?? [])
    .map(i => `${stallById.get(i.stallId)?.name ?? '?'}: ${qtyText(i.stockQty)} @ ${rupiah(effectiveFor(p, consignorById.get(p.consignorId), i).price)}`).join('; ');
  const cols: ExportCol<CProduct>[] = [
    { header: 'Kode', width: '8%', value: p => p.code },
    { header: 'Produk', width: '16%', bold: true, value: p => p.name },
    { header: 'Penitip', width: '13%', value: p => consignorById.get(p.consignorId)?.name ?? '-' },
    { header: 'Satuan', width: '6%', value: p => p.unit },
    { header: 'Harga Default', width: '11%', align: 'right', value: p => rupiah(p.defaultPrice) },
    { header: 'Bagi Hasil', width: '13%', value: p => schemeText(effectiveFor(p, consignorById.get(p.consignorId), undefined).spec) },
    { header: 'Lapak (stok @ harga)', width: '25%', value: p => stallSummary(p) || '-' },
    { header: 'Status', width: '8%', value: p => p.isActive ? 'Aktif' : 'Nonaktif' },
  ];

  return (
    <div className="space-y-4">
      <DataList<CProduct>
        creds={creds} items={items} totalCount={data.products.length} getId={p => p.id} noun="produk"
        searchText={p => `${p.name} ${p.code} ${consignorById.get(p.consignorId)?.name ?? ''}`}
        searchPlaceholder="Cari produk, kode, atau penitip…" viewKey="consign-products" resetKey={`${consignorFilter}|${stallFilter}`}
        addLabel={can('create') ? 'Tambah Produk' : undefined} onAdd={can('create') ? openNew : undefined}
        emptyHint="Produk titipan = barang milik penitip yang dijual di lapak. Tambahkan penitip & lapak dulu di tabnya."
        avatar={p => initials(p.name)}
        filters={(
          <>
            <FilterSelect value={consignorFilter} onChange={setConsignorFilter} searchPlaceholder="Cari penitip…"
              options={[{ value: '', label: 'Semua penitip' }, ...data.consignors.map(c => ({ value: c.id, label: c.name }))]} />
            <FilterSelect value={stallFilter} onChange={setStallFilter} searchPlaceholder="Cari lapak…"
              options={[{ value: '', label: 'Semua lapak' }, ...data.stalls.map(s => ({ value: s.id, label: s.name }))]} />
          </>
        )}
        renderBody={p => {
          const c = consignorById.get(p.consignorId);
          const its = itemsByProduct.get(p.id) ?? [];
          const base = effectiveFor(p, c, undefined);
          return (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                <Badge>{p.code}</Badge>
                {!p.isActive && <Badge tone="danger">Nonaktif</Badge>}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c?.name ?? '—'} · {rupiah(base.price)}/{p.unit} · {schemeText(base.spec)}</p>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {its.length === 0 && <Badge>Belum ada lapak</Badge>}
                {its.map(i => (
                  <Badge key={i.id} tone={i.stockQty > 0 ? 'ok' : 'muted'}>
                    {stallById.get(i.stallId)?.name ?? '?'}: {qtyText(i.stockQty)} · {rupiah(effectiveFor(p, c, i).price)}
                  </Badge>
                ))}
              </div>
            </>
          );
        }}
        actions={p => <RowActions onEdit={can('edit') ? () => openEdit(p) : undefined}
          onDelete={can('delete') ? () => del(p) : undefined} deleting={deletingId === p.id} />}
        onBulkDelete={can('delete') ? bulkDelete : undefined} importer={importer}
        exportCols={cols} exportTitle="DAFTAR PRODUK TITIP JUAL" exportFile="produk-titip-jual"
      />

      {editing && (
        <ModalShell title={editing.id ? 'Edit Produk Titipan' : 'Tambah Produk Titipan'} subtitle="Harga & bagi hasil per lapak"
          icon={<Package size={17} />} onClose={() => setEditing(null)} size="modal-md"
          footer={<ModalFooter onClose={() => setEditing(null)} onSave={save} saving={saving}
            disabled={!editing.name.trim() || !editing.consignorId} label="Simpan Produk" />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Penitip" required>
              <select className="input" value={editing.consignorId} onChange={e => setEditing({ ...editing, consignorId: e.target.value })}>
                <option value="">{data.consignors.length === 0 ? '— Belum ada penitip (tambah di tab Penitip) —' : '— Pilih penitip —'}</option>
                {data.consignors.filter(c => c.isActive || c.id === editing.consignorId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Nama Produk" required>
              <input className="input" value={editing.name} autoFocus={!editing.id} onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Harga jual default (Rp)" required>
                <input className="input" type="number" min={0} inputMode="numeric" value={editing.defaultPrice} onChange={e => setEditing({ ...editing, defaultPrice: e.target.value })} />
              </Field>
              <Field label="Satuan">
                <input className="input" value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value })} />
              </Field>
            </div>
            <Field label="Skema bagi hasil produk">
              <SchemeFields scheme={editing.scheme} value={editing.schemeValue} allowInherit price={editPrice}
                inheritLabel={editConsignor ? `Ikut penitip (${schemeText({ scheme: editConsignor.scheme, value: editConsignor.schemeValue })})` : 'Ikut default penitip'}
                onChange={(s, v) => setEditing({ ...editing, scheme: s, schemeValue: v })} />
            </Field>

            <div>
              <p className="field-label">Dijual di lapak</p>
              {data.stalls.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada lapak. Tambahkan di tab Lapak.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.stalls.map(s => {
                    const cfg = editing.stalls[s.id];
                    if (!cfg) return null;
                    const stallPrice = cfg.price === '' ? editPrice : Number(cfg.price) || 0;
                    return (
                      <div key={s.id} className="card p-3" style={{ borderColor: cfg.enabled ? 'var(--accent)' : undefined }}>
                        <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          <input type="checkbox" checked={cfg.enabled} onChange={e => setStall(s.id, { enabled: e.target.checked })} />
                          {s.name} {!s.isActive && <Badge tone="danger">Nonaktif</Badge>}
                        </label>
                        {cfg.enabled && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                            <Field label="Harga jual di lapak ini (kosong = default)">
                              <input className="input" type="number" min={0} inputMode="numeric" value={cfg.price} placeholder={String(editPrice)}
                                onChange={e => setStall(s.id, { price: e.target.value })} />
                            </Field>
                            <Field label="Skema bagi hasil di lapak ini">
                              <SchemeFields scheme={cfg.scheme} value={cfg.schemeValue} allowInherit price={stallPrice}
                                inheritLabel="Ikut produk / penitip"
                                onChange={(sc, v) => setStall(s.id, { scheme: sc, schemeValue: v })} />
                            </Field>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Lapak yang sudah punya stok tidak bisa dilepas — kembalikan stoknya lebih dulu lewat tab Dokumen.
              </p>
            </div>

            <Field label="Catatan (opsional)">
              <textarea className="input" style={{ resize: 'vertical', minHeight: 56 }} value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} />
              Produk aktif
            </label>
            <ErrorBox message={error} />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
