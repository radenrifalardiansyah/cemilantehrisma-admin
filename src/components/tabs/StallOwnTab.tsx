'use client';

import { useState, useEffect } from 'react';
import { Truck, Tag, HandCoins } from 'lucide-react';
import PageLoader from '@/components/PageLoader';
import type { Action } from '@/types/rbac';
import { API, type Stall, type Warehouse } from './titip-jual/shared';
import ShipmentsSection from './stall-own/ShipmentsSection';
import PricesSection from './stall-own/PricesSection';
import SettlementsSection from './stall-own/SettlementsSection';

type SubTab = 'shipments' | 'prices' | 'settlements';
const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'shipments', label: 'Kirim & Retur', Icon: Truck },
  { id: 'prices', label: 'Harga di Lapak', Icon: Tag },
  { id: 'settlements', label: 'Setoran Lapak', Icon: HandCoins },
];

async function fetchBase(creds: string): Promise<{ stalls: Stall[]; warehouses: Warehouse[] }> {
  const h = { 'x-admin-auth': creds };
  const [s, w] = await Promise.all([
    fetch(`${API}/api/stalls`, { headers: h }).then(r => r.ok ? r.json() as Promise<{ stalls: Stall[] }> : { stalls: [] }),
    fetch(`${API}/api/warehouses`, { headers: h }).then(r => r.ok ? r.json() as Promise<{ warehouses: Warehouse[] }> : { warehouses: [] }),
  ]);
  return { stalls: s.stalls, warehouses: w.warehouses };
}

// Produk Toko di Lapak: toko "menitipkan" produknya ke lapak (Kirim ke Lapak), lapak menjualnya di Kasir Lapak
// dengan harga khusus lapak, lalu menyetor hasilnya ke toko lewat Setoran (jadi Pemasukan toko).
export default function StallOwnTab({ creds, can }: { creds: string; can: (a: Action) => boolean }) {
  const [sub, setSub] = useState<SubTab>('shipments');
  const [base, setBase] = useState<{ stalls: Stall[]; warehouses: Warehouse[] } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchBase(creds).then(d => { if (alive) setBase(d); });
    return () => { alive = false; };
  }, [creds]);

  if (!base) return <PageLoader />;
  const props = { creds, stalls: base.stalls, warehouses: base.warehouses, can: (a: 'view' | 'create' | 'edit' | 'delete') => can(a) };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="inline-flex max-w-full rounded-xl overflow-x-auto no-scrollbar border" style={{ borderColor: 'var(--border)' }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSub(t.id)} aria-label={t.label}
              className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs font-bold transition-all whitespace-nowrap flex-shrink-0"
              style={sub === t.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
              <t.Icon size={13} /> <span className={sub === t.id ? '' : 'hidden sm:inline'}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 animate-fade-up">
          {sub === 'shipments' && <ShipmentsSection {...props} />}
          {sub === 'prices' && <PricesSection {...props} />}
          {sub === 'settlements' && <SettlementsSection {...props} />}
        </div>
      </div>
    </div>
  );
}
