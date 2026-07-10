'use client';

import { useState, useEffect } from 'react';
import { Loader2, Check, Store, Phone, FileText, Shield, Clock, Save } from 'lucide-react';
import ScrollChips from '@/components/ScrollChips';
import { useToast } from '@/components/Toast';

const API = '';

interface StoreSettings {
  storeName?: string; storeTagline?: string; storeDescription?: string;
  whatsapp?: string; instagramUrl?: string; tiktokUrl?: string;
  address?: string; city?: string;
  privacyPolicy?: string; termsOfService?: string; returnPolicy?: string;
  minOrderWhatsapp?: string; openHours?: string;
  freeShippingMin?: number; resellerDiscount?: number;
  announcementBanner?: string; announcementActive?: boolean;
}

const FIELD_GROUPS = [
  {
    id: 'store', icon: <Store size={15}/>, label: 'Info Toko',
    fields: [
      { key: 'storeName',        label: 'Nama Toko',       type: 'text',     placeholder: 'Cemilan Teh Risma' },
      { key: 'storeTagline',     label: 'Tagline',         type: 'text',     placeholder: 'Camilan khas rumahan...' },
      { key: 'storeDescription', label: 'Deskripsi Toko',  type: 'textarea', placeholder: 'Tentang toko Anda...' },
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
];

export default function SettingsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const [settings,  setSettings]  = useState<StoreSettings>({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [activeGrp, setActiveGrp] = useState('store');

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/api/settings`, { headers });
      if (r.ok) { const { settings: s } = await r.json() as { settings: StoreSettings }; setSettings(s ?? {}); }
      setLoading(false);
    })();
  }, []);

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

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  const activeGroup = FIELD_GROUPS.find(g => g.id === activeGrp)!;

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Pengaturan Toko</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Ubah tanpa perlu redeploy</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
          {saved ? 'Tersimpan' : 'Simpan'}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 lg:gap-6">

        {/* Sidebar group picker */}
        <aside className="flex-shrink-0 sm:w-[180px] hidden sm:block">
          <div className="card p-2 space-y-0.5">
            {FIELD_GROUPS.map(g => (
              <button
                key={g.id}
                onClick={() => setActiveGrp(g.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors text-left ${
                  activeGrp === g.id
                    ? 'text-white'
                    : ''
                }`}
                style={activeGrp === g.id
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { color: 'var(--text-secondary)' }}
              >
                <span style={{ color: activeGrp === g.id ? '#fff' : 'var(--text-muted)' }}>{g.icon}</span>
                {g.label}
              </button>
            ))}
          </div>
        </aside>

        {/* Mobile tab chips */}
        <div className="sm:hidden">
          <ScrollChips gap="gap-2">
            {FIELD_GROUPS.map(g => (
              <button
                key={g.id}
                onClick={() => setActiveGrp(g.id)}
                className={`tab-chip ${activeGrp === g.id ? 'active' : ''}`}
              >
                {g.icon}{g.label}
              </button>
            ))}
          </ScrollChips>
        </div>

        {/* Form fields */}
        <div className="flex-1 min-w-0">
          <div className="card p-5">
            <div className="flex items-center gap-2.5 mb-5" style={{ borderBottom: '1px solid var(--border-2)', paddingBottom: '1rem' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                {activeGroup.icon}
              </div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{activeGroup.label}</p>
            </div>

            <div className="space-y-4">
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
          </div>
        </div>
      </div>

      {/* Save bar (mobile floating) */}
      <div className="fixed bottom-20 right-4 sm:hidden z-40">
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary flex items-center gap-2 px-5 py-3 text-sm shadow-xl"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? 'Tersimpan!' : 'Simpan Pengaturan'}
        </button>
      </div>
    </div>
  );
}
