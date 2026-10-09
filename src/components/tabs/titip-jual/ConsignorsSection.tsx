'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import ImageUploadBox from '@/components/ImageUploadBox';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { schemeText } from '@/lib/consign';
import DataList, { RowActions, DetailPanel, initials, type ExportCol } from './DataList';
import { downloadTemplate, readRows, type ImportCol } from './importers';
import {
  API, Badge, Field, ModalShell, ModalFooter, ErrorBox, SchemeFields, deleteMany, reportImport,
  type SectionProps, type Consignor,
} from './shared';

const IMPORT_COLS: ImportCol[] = [
  { header: 'Nama*', key: 'name', width: 24, aliases: ['nama', 'namapenitip', 'penitip'], required: true },
  { header: 'Telepon', key: 'phone', width: 18, aliases: ['telepon', 'telp', 'hp', 'whatsapp', 'phone'] },
  { header: 'Alamat', key: 'address', width: 30, aliases: ['alamat', 'address'] },
  { header: 'Skema (Nominal/Komisi)', key: 'scheme', width: 22, aliases: ['skema', 'skemabagihasil'] },
  { header: 'Nilai (Rp setor atau % komisi)', key: 'value', width: 28, aliases: ['nilai', 'nilaibagihasil', 'setor', 'komisi'] },
  { header: 'Bank', key: 'bankName', width: 14, aliases: ['bank', 'namabank'] },
  { header: 'No. Rekening', key: 'bankAccount', width: 20, aliases: ['norekening', 'nomorrekening', 'rekening'] },
  { header: 'Atas Nama', key: 'bankHolder', width: 20, aliases: ['atasnama', 'pemilikrekening'] },
  { header: 'Catatan', key: 'note', width: 28, aliases: ['catatan', 'note'] },
];

const EMPTY: Omit<Consignor, 'id' | 'code'> = {
  name: '', phone: '', address: '', bankName: '', bankAccount: '', bankHolder: '', note: '', logoUrl: '',
  scheme: null, schemeValue: 0, isActive: true,
};

export default function ConsignorsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [editing, setEditing] = useState<(Omit<Consignor, 'id' | 'code'> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);

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

  const importer = can('create') ? {
    onTemplate: () => downloadTemplate({
      sheet: 'Template Penitip', title: 'TEMPLATE IMPORT DATA PENITIP — CEMILAN TEH RISMA', file: 'template-penitip.xlsx',
      note: 'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3; isi data mulai baris 4, satu penitip per baris. '
        + 'Skema: isi "Nominal" (harga setor tetap per unit, nilai = rupiah) atau "Komisi" (persen untuk kita, nilai = persen). Kosong = belum ditentukan (skema wajib diisi di setiap produk penitip ini). '
        + 'Penitip dengan nama yang sudah ada dilewati.',
      cols: IMPORT_COLS, textKeys: ['phone', 'bankAccount'],
      example: { name: 'Bu Sari Kue Kering', phone: '081234567890', address: 'Jl. Melati No. 3', scheme: 'Nominal', value: '10000', bankName: 'BCA', bankAccount: '1234567890', bankHolder: 'Sari', note: 'Contoh — timpa dengan data penitip Anda' },
    }),
    onFile: async (file: File) => {
      try {
        const parsed = await readRows(file, IMPORT_COLS);
        if ('error' in parsed) { toast.error(parsed.error); return; }
        const rows = parsed.rows.filter(r => r.name.trim());
        if (rows.length === 0) { toast.error('Tidak ada data penitip valid pada file tersebut.'); return; }
        const r = await fetch(`${API}/api/consignors/bulk-import`, { method: 'POST', headers, body: JSON.stringify({ consignors: rows }) });
        const d = await r.json().catch(() => ({})) as { error?: string; created: number; skippedDuplicate: number; errors: string[]; errorCount: number };
        if (!r.ok) { toast.error(d.error ?? 'Gagal mengimpor data penitip.'); return; }
        await reload();
        reportImport(toast, 'penitip', d);
      } catch {
        toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
      }
    },
  } : undefined;

  const cols: ExportCol<Consignor>[] = [
    { header: 'Kode', width: '8%', value: c => c.code },
    { header: 'Nama', width: '16%', bold: true, value: c => c.name },
    { header: 'Telepon', width: '12%', value: c => c.phone || '-' },
    { header: 'Bagi Hasil', width: '14%', value: c => c.scheme ? schemeText({ scheme: c.scheme, value: c.schemeValue }) : 'Belum ditentukan' },
    { header: 'Produk', width: '7%', align: 'center', value: c => productCount.get(c.id) ?? 0 },
    { header: 'Bank', width: '14%', value: c => [c.bankName, c.bankAccount].filter(Boolean).join(' ') || '-' },
    { header: 'Atas Nama', width: '12%', value: c => c.bankHolder || '-' },
    { header: 'Status', width: '8%', value: c => c.isActive ? 'Aktif' : 'Nonaktif' },
  ];

  // Logo diperkecil (maks 400px) dan dikompres sebelum diunggah — sama seperti logo Mitra.
  const uploadLogo = async (file: File) => {
    setLogoUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob: Blob = await new Promise(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.85));
      const form = new FormData();
      form.append('file', new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers: { 'x-admin-auth': creds }, body: form });
      if (!r.ok) throw new Error('upload failed');
      const { url } = await r.json() as { url: string };
      setEditing(e => e && ({ ...e, logoUrl: url }));
    } catch {
      toast.error('Gagal mengunggah logo penitip.');
    } finally {
      setLogoUploading(false);
    }
  };

  const openNew = () => { setError(''); setEditing({ ...EMPTY }); };

  return (
    <div className="space-y-4">
      <DataList<Consignor>
        creds={creds} items={items} totalCount={data.consignors.length} getId={c => c.id} noun="penitip"
        searchText={c => `${c.name} ${c.code} ${c.phone}`} searchPlaceholder="Cari nama, kode, atau telepon…" viewKey="consign-consignors"
        addLabel={can('create') ? 'Tambah Penitip' : undefined} onAdd={can('create') ? openNew : undefined}
        emptyHint="Penitip = pihak luar yang menitipkan barangnya untuk dijual di lapak kita."
        avatar={c => initials(c.name)} avatarImage={c => c.logoUrl || undefined}
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
              {c.scheme
                ? <Badge tone="accent">{schemeText({ scheme: c.scheme, value: c.schemeValue })}</Badge>
                : <Badge>Skema: belum ditentukan</Badge>}
              <Badge>{productCount.get(c.id) ?? 0} produk</Badge>
            </div>
          </>
        )}
        renderDetail={c => {
          const bank = data.banks.find(b => b.name === c.bankName);
          const prods = data.products.filter(p => p.consignorId === c.id);
          const stock = data.stallItems.filter(i => prods.some(p => p.id === i.productId)).reduce((a, i) => a + i.stockQty, 0);
          return (
            <DetailPanel fields={[
              { label: 'Kode Penitip', value: c.code },
              { label: 'Status', value: c.isActive ? 'Aktif' : 'Nonaktif' },
              { label: 'Telepon', value: c.phone },
              { label: 'Skema Bagi Hasil', value: c.scheme ? schemeText({ scheme: c.scheme, value: c.schemeValue }) : 'Belum ditentukan' },
              { label: 'Jumlah Produk', value: String(prods.length) },
              { label: 'Total Stok Titipan', value: stock.toLocaleString('id-ID') },
              { label: 'Alamat', value: c.address, wide: true },
              { label: 'Bank', value: c.bankName ? (
                <span className="inline-flex items-center gap-1.5">
                  {bank?.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bank.logoUrl} alt="" className="w-5 h-5" style={{ objectFit: 'contain' }} />
                  )}
                  {c.bankName}
                </span>
              ) : '' },
              { label: 'No. Rekening', value: c.bankAccount },
              { label: 'Atas Nama', value: c.bankHolder, wide: true },
              ...(c.note ? [{ label: 'Catatan', value: c.note, wide: true }] : []),
            ]} />
          );
        }}
        actions={c => <RowActions onEdit={can('edit') ? () => { setError(''); setEditing({ ...c }); } : undefined}
          onDelete={can('delete') ? () => del(c) : undefined} deleting={deletingId === c.id} />}
        onBulkDelete={can('delete') ? bulkDelete : undefined} importer={importer}
        exportCols={cols} exportTitle="DAFTAR PENITIP" exportFile="penitip"
      />

      {editing && (
        <ModalShell title={editing.id ? 'Edit Penitip' : 'Tambah Penitip'} subtitle="Pihak luar yang menitipkan barang"
          icon={<Users size={17} />} onClose={() => setEditing(null)}
          footer={<ModalFooter onClose={() => setEditing(null)} onSave={save} saving={saving} disabled={!editing.name.trim()} label="Simpan Penitip" />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="flex items-center gap-3">
              <ImageUploadBox src={editing.logoUrl} alt={editing.name || 'Logo penitip'} uploading={logoUploading}
                onSelect={f => uploadLogo(f)} onRemove={() => setEditing({ ...editing, logoUrl: '' })}
                icon={<Users size={18} />} fit="contain" size={56} emptyText="Logo" />
              <div style={{ flex: 1 }}>
                <Field label="Nama Penitip" required>
                  <input className="input" value={editing.name} autoFocus onChange={e => setEditing({ ...editing, name: e.target.value })} />
                </Field>
              </div>
            </div>
            <Field label="Telepon / WhatsApp (opsional)">
              <input className="input" value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} />
            </Field>
            <Field label="Alamat (opsional)">
              <input className="input" value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} />
            </Field>
            <Field label="Skema bagi hasil default">
              <SchemeFields scheme={editing.scheme} value={editing.schemeValue} allowInherit
                inheritLabel="Belum ditentukan (isi skema di setiap produk)"
                onChange={(s, v) => setEditing({ ...editing, scheme: s, schemeValue: v ?? 0 })} />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Berlaku untuk produk penitip ini yang tidak punya skema sendiri. Pilih &quot;Belum ditentukan&quot; kalau harga setor tiap produk berbeda — skema lalu wajib diisi di setiap produk.
              </p>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Bank">
                <SearchSelect value={editing.bankName} onChange={v => setEditing({ ...editing, bankName: v })}
                  options={data.banks.map(b => ({ value: b.name, label: b.name, sublabel: b.bankCode ? `Kode: ${b.bankCode}` : undefined, imageUrl: b.logoUrl }))}
                  placeholder="– Pilih bank –" searchPlaceholder="Cari bank…" />
              </Field>
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
