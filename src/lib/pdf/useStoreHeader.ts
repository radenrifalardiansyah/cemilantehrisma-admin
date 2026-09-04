'use client';

import { useEffect, useState } from 'react';
import { toDataUri } from './logo';
import type { StoreHeader } from './ShipmentNotePDF';

interface SettingsShape {
  storeName?: string; storeTagline?: string; ownerName?: string;
  address?: string; city?: string; whatsapp?: string; logo?: string;
}

// Sama seperti pola storeHeader di ConsignmentTab/ProductReportTab/FinanceReportTab/
// StockReportTab (fetch /api/settings + resolve logo ke data-URI), diekstrak jadi satu hook
// supaya setiap tab yang menambah Export PDF baru tidak perlu copy-paste ulang boilerplate ini.
// Tidak menyertakan ownerSignature/ownerStamp — itu spesifik untuk nota/invoice yang butuh
// tanda tangan, tidak dipakai laporan tabel biasa.
export function useStoreHeader(creds: string): StoreHeader {
  const [settings, setSettings] = useState<SettingsShape>({});
  const [logoDataUri, setLogoDataUri] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch('/api/settings', { headers: { 'x-admin-auth': creds } })
      .then(async r => { if (r.ok) setSettings((await r.json() as { settings: SettingsShape }).settings ?? {}); })
      .catch(() => {});
  }, [creds]);

  useEffect(() => { toDataUri(settings.logo).then(setLogoDataUri); }, [settings.logo]);

  return {
    name: settings.storeName?.trim() || 'Cemilan Teh Risma',
    tagline: settings.storeTagline?.trim() || undefined,
    ownerName: settings.ownerName?.trim() || undefined,
    address: [settings.address, settings.city].filter(Boolean).join(', ') || undefined,
    phone: settings.whatsapp?.trim() || undefined,
    logo: logoDataUri,
  };
}
