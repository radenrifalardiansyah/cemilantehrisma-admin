'use client';

import { useState, useEffect } from 'react';
import { Loader2, Check, Settings, Store, Phone, FileText, Shield } from 'lucide-react';

const API = '';

interface StoreSettings {
  storeName: string;
  tagline: string;
  whatsappNumber: string;
  address: string;
  nib: string;
  halalCertNo: string;
  instagramHandle: string;
  productionCity: string;
  shelfLifeDays: number;
  freeDeliveryMinimum: number;
  announcementBar: string;
}

const DEFAULTS: StoreSettings = {
  storeName: 'Cemilan Teh Risma',
  tagline: 'Camilan Sehat, Renyah, & Lezat dari Bogor',
  whatsappNumber: '6281212132014',
  address: 'Bogor, Jawa Barat',
  nib: '0403260068412',
  halalCertNo: '',
  instagramHandle: '',
  productionCity: 'Bogor',
  shelfLifeDays: 90,
  freeDeliveryMinimum: 0,
  announcementBar: '',
};

export default function SettingsTab({ creds }: { creds: string }) {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  useEffect(() => {
    fetch(`${API}/api/settings`, { headers })
      .then(r => r.json() as Promise<Partial<StoreSettings>>)
      .then(d => { setSettings({ ...DEFAULTS, ...d }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false);
    await fetch(`${API}/api/settings`, {
      method: 'PUT', headers,
      body: JSON.stringify(settings),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const field = (label: string, key: keyof StoreSettings, type: 'text' | 'number' | 'tel' = 'text', placeholder = '') => (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      <input type={type} value={settings[key] as string | number}
        placeholder={placeholder}
        onChange={e => setSettings(s => ({ ...s, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50" />
    </div>
  );

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-amber-400" /></div>;

  return (
    <div className="px-4 py-5 pb-10 space-y-5 max-w-2xl mx-auto w-full">

      {/* Info Toko */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Store size={15} className="text-amber-500" />
          <p className="text-sm font-bold text-gray-700">Info Toko</p>
        </div>
        {field('Nama Toko', 'storeName')}
        {field('Tagline', 'tagline')}
        {field('Kota Produksi', 'productionCity')}
        {field('Alamat', 'address')}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Pengumuman (Banner Bar)</label>
          <textarea rows={2} value={settings.announcementBar}
            onChange={e => setSettings(s => ({ ...s, announcementBar: e.target.value }))}
            placeholder="Mis: Gratis ongkir min. order 3 pcs..."
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50 resize-none" />
        </div>
      </div>

      {/* Kontak */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Phone size={15} className="text-amber-500" />
          <p className="text-sm font-bold text-gray-700">Kontak</p>
        </div>
        {field('Nomor WhatsApp (format: 628xxx)', 'whatsappNumber', 'tel')}
        {field('Instagram Handle (tanpa @)', 'instagramHandle', 'text', 'cemilantehrisma')}
      </div>

      {/* Legal */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={15} className="text-amber-500" />
          <p className="text-sm font-bold text-gray-700">Legalitas</p>
        </div>
        {field('NIB', 'nib')}
        {field('No. Sertifikat Halal', 'halalCertNo')}
      </div>

      {/* Operasional */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Settings size={15} className="text-amber-500" />
          <p className="text-sm font-bold text-gray-700">Operasional</p>
        </div>
        {field('Masa Simpan Produk (hari)', 'shelfLifeDays', 'number')}
        {field('Min. Order Gratis Ongkir (Rp, 0 = tidak ada)', 'freeDeliveryMinimum', 'number')}
      </div>

      {/* Note */}
      <div className="bg-amber-50 rounded-2xl border border-amber-100 px-4 py-3 flex gap-2">
        <Shield size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700">Perubahan pengaturan di sini tersimpan di Firebase dan bisa dibaca oleh main app secara real-time tanpa perlu deploy ulang.</p>
      </div>

      <button onClick={save} disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white shadow-lg disabled:opacity-40 transition-all"
        style={{ background: saved ? 'linear-gradient(135deg,#16A34A,#22C55E)' : 'linear-gradient(135deg,#D97706,#EA580C)' }}>
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {saving ? 'Menyimpan...' : saved ? 'Tersimpan!' : 'Simpan Pengaturan'}
      </button>
    </div>
  );
}
