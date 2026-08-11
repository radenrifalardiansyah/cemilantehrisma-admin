'use client';

import { useState, useEffect } from 'react';
import { Loader2, Check, Store, Phone, FileText, Shield, Clock, Save, Database, RefreshCw, Landmark, Upload, X, Image as ImageIcon, Warehouse } from 'lucide-react';
import ScrollChips from '@/components/ScrollChips';
import SearchSelect from '@/components/SearchSelect';
import { useToast } from '@/components/Toast';
import Tooltip from '@/components/Tooltip';

const API = '';

interface StoreSettings {
  storeName?: string; storeTagline?: string; storeDescription?: string; logo?: string;
  ownerName?: string; ownerSignature?: string; ownerStamp?: string;
  whatsapp?: string; instagramUrl?: string; tiktokUrl?: string;
  address?: string; city?: string;
  privacyPolicy?: string; termsOfService?: string; returnPolicy?: string;
  minOrderWhatsapp?: string; openHours?: string;
  freeShippingMin?: number; resellerDiscount?: number;
  announcementBanner?: string; announcementActive?: boolean;
  posWarehouseId?: string; posWarehouseName?: string;
}

interface SettingsWarehouse { id: string; name: string }

const FIELD_GROUPS = [
  {
    id: 'store', icon: <Store size={15}/>, label: 'Info Toko',
    fields: [
      { key: 'storeName',        label: 'Nama Toko',       type: 'text',     placeholder: 'Cemilan Teh Risma' },
      { key: 'storeTagline',     label: 'Tagline',         type: 'text',     placeholder: 'Camilan khas rumahan...' },
      { key: 'storeDescription', label: 'Deskripsi Toko',  type: 'textarea', placeholder: 'Tentang toko Anda...' },
      { key: 'ownerName',        label: 'Nama Pemilik',    type: 'text',     placeholder: 'Nama pemilik untuk tanda tangan PDF' },
      { key: 'address',          label: 'Alamat',          type: 'text',     placeholder: 'Jl. ...' },
      { key: 'city',             label: 'Kota',            type: 'text',     placeholder: 'Kota / Kabupaten' },
    ],
  },
  {
    id: 'contact', icon: <Phone size={15}/>, label: 'Kontak & Sosial Media',
    fields: [
      { key: 'whatsapp',      label: 'WhatsApp',   type: 'text', placeholder: '628xxx' },
      { key: 'instagramUrl',  label: 'Instagram',  type: 'text', placeholder: 'https://instagram.com/...' },
      { key: 'tiktokUrl',     label: 'TikTok',     type: 'text', placeholder: 'https://tiktok.com/...' },
    ],
  },
  {
    id: 'operational', icon: <Clock size={15}/>, label: 'Operasional & Reseller',
    fields: [
      { key: 'openHours',         label: 'Jam Buka',              type: 'text',   placeholder: 'Senin–Sabtu 08.00–17.00' },
      { key: 'minOrderWhatsapp',  label: 'Min. Order WhatsApp',   type: 'text',   placeholder: 'Rp 50.000' },
      { key: 'freeShippingMin',   label: 'Min. Gratis Ongkir (Rp)', type: 'number', placeholder: '100000' },
      { key: 'resellerDiscount',  label: 'Diskon Reseller (%)',   type: 'number', placeholder: '10' },
      { key: 'announcementBanner',label: 'Banner Pengumuman',     type: 'text',   placeholder: 'Promo spesial...' },
    ],
  },
  {
    id: 'legal', icon: <Shield size={15}/>, label: 'Kebijakan & Ketentuan',
    fields: [
      { key: 'privacyPolicy',  label: 'Kebijakan Privasi', type: 'textarea', placeholder: 'Isi kebijakan privasi...' },
      { key: 'termsOfService', label: 'Syarat & Ketentuan', type: 'textarea', placeholder: 'Isi syarat & ketentuan...' },
      { key: 'returnPolicy',   label: 'Kebijakan Pengembalian', type: 'textarea', placeholder: 'Isi kebijakan retur...' },
    ],
  },
  {
    id: 'sync', icon: <Database size={15}/>, label: 'Sinkronisasi Data',
    fields: [],
  },
];

export default function SettingsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const [settings,  setSettings]  = useState<StoreSettings>({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [activeGrp, setActiveGrp] = useState('store');
  const [bankCount,   setBankCount]   = useState<number | null>(null);
  const [syncingBanks, setSyncingBanks] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [stampUploading, setStampUploading] = useState(false);
  const [warehouses, setWarehouses] = useState<SettingsWarehouse[]>([]);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/api/settings`, { headers });
      if (r.ok) { const { settings: s } = await r.json() as { settings: StoreSettings }; setSettings(s ?? {}); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/api/warehouses`, { headers });
      if (r.ok) setWarehouses((await r.json() as { warehouses: SettingsWarehouse[] }).warehouses);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBankCount = async () => {
    const r = await fetch(`${API}/api/master-banks`, { headers });
    if (r.ok) { const { banks } = await r.json() as { banks: unknown[] }; setBankCount(banks.length); }
  };
  useEffect(() => { loadBankCount(); }, []);

  const syncBanks = async () => {
    setSyncingBanks(true);
    const r = await fetch(`${API}/api/master-banks/sync`, { method: 'POST', headers });
    if (r.ok) {
      const d = await r.json() as { synced: number; total: number };
      await loadBankCount();
      toast.success(d.synced > 0 ? `${d.synced} bank baru disinkronkan (${d.total} total tersedia).` : 'Semua data bank sudah tersinkron.');
    } else {
      toast.error('Gagal menyinkronkan data bank.');
    }
    setSyncingBanks(false);
  };

  const save = async () => {
    setSaving(true);
    const r = await fetch(`${API}/api/settings`, {
      method: 'PUT', headers,
      body: JSON.stringify(settings),
    });
    setSaving(false);
    if (r.ok) {
      setSaved(true);
      toast.success('Pengaturan berhasil disimpan.');
      setTimeout(() => setSaved(false), 2500);
    } else {
      toast.error('Gagal menyimpan pengaturan.');
    }
  };

  const set = (key: string, val: string | number | boolean) =>
    setSettings(s => ({ ...s, [key]: val }));

  // keepAlpha (PNG) untuk ttd/cap supaya latar tetap transparan saat ditumpuk di PDF.
  const compressImage = async (file: File, maxPx: number, keepAlpha: boolean): Promise<File> => {
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const type = keepAlpha ? 'image/png' : 'image/jpeg';
    const ext  = keepAlpha ? '.png' : '.jpg';
    return new Promise(resolve =>
      canvas.toBlob(
        blob => resolve(new File([blob!], file.name.replace(/\.\w+$/, ext), { type })),
        type, keepAlpha ? undefined : 0.82,
      ),
    );
  };
  const compressLogo = (file: File) => compressImage(file, 1200, false);

  const uploadImage = async (
    file: File | undefined,
    key: 'logo' | 'ownerSignature' | 'ownerStamp',
    compress: (f: File) => Promise<File>,
    setUploading: (v: boolean) => void,
    errorLabel: string,
  ) => {
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compress(file);
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers: { 'x-admin-auth': creds }, body: form });
      if (!r.ok) throw new Error('upload failed');
      const { url } = await r.json() as { url: string };
      set(key, url);
    } catch {
      toast.error(`Gagal mengunggah ${errorLabel}.`);
    } finally {
      setUploading(false);
    }
  };

  const uploadLogo      = (file?: File) => uploadImage(file, 'logo', compressLogo, setLogoUploading, 'logo');
  const uploadSignature = (file?: File) => uploadImage(file, 'ownerSignature', f => compressImage(f, 800, true), setSignatureUploading, 'tanda tangan');
  const uploadStamp     = (file?: File) => uploadImage(file, 'ownerStamp', f => compressImage(f, 800, true), setStampUploading, 'cap/stempel');

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  const activeGroup = FIELD_GROUPS.find(g => g.id === activeGrp)!;

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>

      {/* Sub-navigation */}
      <ScrollChips
        className="flex-shrink-0 px-4 pt-3.5 pb-3"
        style={{ borderBottom: '1px solid var(--border-2)' }}
      >
        {FIELD_GROUPS.map(g => (
          <button
            key={g.id}
            onClick={() => setActiveGrp(g.id)}
            className={`tab-chip${activeGrp === g.id ? ' active' : ''}`}
          >
            {g.icon}{g.label}
          </button>
        ))}
      </ScrollChips>

      {/* Content */}
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 space-y-5">

          <div className="card p-5">
            <div className="flex items-center gap-2.5 mb-5" style={{ borderBottom: '1px solid var(--border-2)', paddingBottom: '1rem' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                {activeGroup.icon}
              </div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{activeGroup.label}</p>
            </div>

            {activeGrp === 'sync' ? (
              <div className="space-y-3">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Sinkronkan data master ke Firestore. Bank baru akan ditambahkan, bank yang sudah ada akan diperbarui (mis. kode bank) tanpa duplikasi.
                </p>

                <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                      <Landmark size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Master Bank</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {bankCount === null ? 'Memuat…' : `${bankCount} bank tersimpan di Firestore`}
                      </p>
                    </div>
                  </div>
                  <button onClick={syncBanks} disabled={syncingBanks} className="btn-ghost text-xs flex-shrink-0" style={{ height: 34 }}>
                    {syncingBanks ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {syncingBanks ? 'Menyinkronkan…' : 'Sinkronkan'}
                  </button>
                </div>
              </div>
            ) : (
            <div className="space-y-4">
              {activeGrp === 'store' && (
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Logo Toko
                  </label>
                  <div className="flex items-center gap-3">
                    {settings.logo ? (
                      <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0" style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={settings.logo} alt="Logo toko" className="w-full h-full object-contain" />
                        <Tooltip label="Hapus Logo">
                          <button type="button" onClick={() => set('logo', '')}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                            style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                            <X size={11} />
                          </button>
                        </Tooltip>
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ border: '1px dashed var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                        <ImageIcon size={20} />
                      </div>
                    )}
                    <label className="btn-ghost text-xs cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" disabled={logoUploading}
                        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; uploadLogo(f); }} />
                      {logoUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                      {logoUploading ? 'Mengunggah…' : settings.logo ? 'Ganti Logo' : 'Upload Logo'}
                    </label>
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    Tampil di struk cetak kasir. Sebaiknya gambar persegi & latar polos.
                  </p>
                </div>
              )}
              {activeGrp === 'store' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      Tanda Tangan Elektronik
                    </label>
                    <div className="flex items-center gap-3">
                      {settings.ownerSignature ? (
                        <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0" style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={settings.ownerSignature} alt="Tanda tangan pemilik" className="w-full h-full object-contain" />
                          <Tooltip label="Hapus Tanda Tangan">
                            <button type="button" onClick={() => set('ownerSignature', '')}
                              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                              style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                              <X size={11} />
                            </button>
                          </Tooltip>
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ border: '1px dashed var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                          <ImageIcon size={20} />
                        </div>
                      )}
                      <label className="btn-ghost text-xs cursor-pointer">
                        <input type="file" accept="image/*" className="hidden" disabled={signatureUploading}
                          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; uploadSignature(f); }} />
                        {signatureUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        {signatureUploading ? 'Mengunggah…' : settings.ownerSignature ? 'Ganti' : 'Upload'}
                      </label>
                    </div>
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Foto/scan tanda tangan pemilik, latar transparan (PNG) lebih rapi.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      Cap / Stempel Elektronik
                    </label>
                    <div className="flex items-center gap-3">
                      {settings.ownerStamp ? (
                        <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0" style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={settings.ownerStamp} alt="Cap toko" className="w-full h-full object-contain" />
                          <Tooltip label="Hapus Cap">
                            <button type="button" onClick={() => set('ownerStamp', '')}
                              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                              style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                              <X size={11} />
                            </button>
                          </Tooltip>
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ border: '1px dashed var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                          <ImageIcon size={20} />
                        </div>
                      )}
                      <label className="btn-ghost text-xs cursor-pointer">
                        <input type="file" accept="image/*" className="hidden" disabled={stampUploading}
                          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; uploadStamp(f); }} />
                        {stampUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        {stampUploading ? 'Mengunggah…' : settings.ownerStamp ? 'Ganti' : 'Upload'}
                      </label>
                    </div>
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Foto cap/stempel toko, latar transparan (PNG) lebih rapi.
                    </p>
                  </div>
                </div>
              )}
              {activeGrp === 'operational' && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <Warehouse size={12} /> Gudang untuk Kasir
                  </label>
                  <SearchSelect value={settings.posWarehouseId ?? ''}
                    onChange={id => {
                      const w = warehouses.find(x => x.id === id);
                      setSettings(s => ({ ...s, posWarehouseId: id, posWarehouseName: w?.name ?? '' }));
                    }}
                    options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                    placeholder="– Pilih Gudang –" searchPlaceholder="Cari gudang…" />
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    Setiap transaksi kasir akan mengurangi stok gudang ini juga (selain stok toko). Kosongkan kalau kasir belum diambil dari gudang tertentu.
                  </p>
                </div>
              )}
              {activeGroup.fields.map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {f.label}
                  </label>
                  {f.type === 'textarea' ? (
                    <textarea
                      rows={4}
                      placeholder={f.placeholder}
                      value={(settings as Record<string, string>)[f.key] ?? ''}
                      onChange={e => set(f.key, e.target.value)}
                      className="input w-full text-sm resize-none"
                    />
                  ) : (
                    <input
                      type={f.type}
                      placeholder={f.placeholder}
                      value={(settings as Record<string, string | number>)[f.key] ?? ''}
                      onChange={e => set(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                      className="input w-full text-sm"
                    />
                  )}
                </div>
              ))}

              {/* Announcement toggle — only in operational group */}
              {activeGrp === 'operational' && (
                <div className="flex items-center justify-between pt-2">
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Aktifkan Banner Pengumuman</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Tampilkan banner di halaman utama toko</p>
                  </div>
                  <button
                    onClick={() => set('announcementActive', !settings.announcementActive)}
                    className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
                    style={{ background: settings.announcementActive ? 'var(--accent)' : 'var(--border)' }}
                  >
                    <span
                      className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                      style={{ transform: settings.announcementActive ? 'translateX(20px)' : 'translateX(2px)' }}
                    />
                  </button>
                </div>
              )}
            </div>
            )}

            <div className="flex justify-end pt-4 mt-1" style={{ borderTop: '1px solid var(--border-2)' }}>
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 text-sm"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
                {saved ? 'Tersimpan' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
