'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, Users, Store, Boxes, ArrowLeftRight, RefreshCw, Banknote } from 'lucide-react';
import PageLoader from '@/components/PageLoader';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import type { Action } from '@/types/rbac';
import {
  API, type TitipJualData, type Stall, type Consignor, type CProduct, type StallItem, type Warehouse, type MasterBank, type StaffUser, type Category,
} from './titip-jual/shared';
import ProductsSection from './titip-jual/ProductsSection';
import ConsignorsSection from './titip-jual/ConsignorsSection';
import StallsSection from './titip-jual/StallsSection';
import StockSection from './titip-jual/StockSection';
import ReceiptsSection from './titip-jual/ReceiptsSection';
import SettlementsSection from './titip-jual/SettlementsSection';

type SubTab = 'products' | 'consignors' | 'stalls' | 'stock' | 'receipts' | 'settlements';

const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'products', label: 'Produk', Icon: Package },
  { id: 'consignors', label: 'Penitip', Icon: Users },
  { id: 'stalls', label: 'Lapak', Icon: Store },
  { id: 'stock', label: 'Stok per Lapak', Icon: Boxes },
  { id: 'receipts', label: 'Terima & Retur', Icon: ArrowLeftRight },
  { id: 'settlements', label: 'Rekap & Bayar', Icon: Banknote },
];

// Titip Jual: pihak luar menitipkan barang untuk dijual di lapak kita. Tahap 1 = data induk
// (lapak, penitip, produk + harga/skema per lapak) dan stok titipan (terima/retur). Penjualan via
// Kasir/Order + rekap pembayaran ke penitip menyusul di tahap berikutnya.
async function fetchAll(creds: string): Promise<TitipJualData> {
  const h = { 'x-admin-auth': creds };
  const json = async <T,>(url: string, fallback: T): Promise<T> => {
    const r = await fetch(`${API}${url}`, { headers: h });
    return r.ok ? await r.json() as T : fallback;
  };
  const [s, c, p, w, b, u, cat] = await Promise.all([
    json<{ stalls: Stall[] }>('/api/stalls', { stalls: [] }),
    json<{ consignors: Consignor[] }>('/api/consignors', { consignors: [] }),
    json<{ products: CProduct[]; stallItems: StallItem[] }>('/api/consign/products', { products: [], stallItems: [] }),
    json<{ warehouses: Warehouse[] }>('/api/warehouses', { warehouses: [] }),
    json<{ banks: MasterBank[] }>('/api/master-banks', { banks: [] }),
    json<{ users: StaffUser[] }>('/api/stalls/assignable-users', { users: [] }),
    json<{ categories: Category[] }>('/api/categories', { categories: [] }),
  ]);
  return { stalls: s.stalls, consignors: c.consignors, products: p.products, stallItems: p.stallItems, warehouses: w.warehouses, banks: b.banks, staff: u.users, categories: cat.categories };
}

export default function TitipJualTab({ creds, can }: { creds: string; can: (a: Action) => boolean }) {
  const [sub, setSub] = useState<SubTab>('products');
  const [data, setData] = useState<TitipJualData | null>(null);

  const load = useCallback(async () => { setData(await fetchAll(creds)); }, [creds]);
  useEffect(() => {
    let alive = true;
    fetchAll(creds).then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [creds]);

  if (!data) return <PageLoader />;

  const props = { creds, data, reload: load, can: (a: 'view' | 'create' | 'edit' | 'delete') => can(a), goTo: setSub };

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={() => { load(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </Tooltip>
      </TopbarPortal>

      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="inline-flex max-w-full rounded-xl overflow-x-auto no-scrollbar border" style={{ borderColor: 'var(--border)' }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSub(t.id)}
              aria-label={t.label}
              className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs font-bold transition-all whitespace-nowrap flex-shrink-0"
              style={sub === t.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
              <t.Icon size={13} /> <span className={sub === t.id ? '' : 'hidden sm:inline'}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 animate-fade-up">
          {sub === 'products' && <ProductsSection {...props} />}
          {sub === 'consignors' && <ConsignorsSection {...props} />}
          {sub === 'stalls' && <StallsSection {...props} />}
          {sub === 'stock' && <StockSection {...props} />}
          {sub === 'receipts' && <ReceiptsSection {...props} />}
          {sub === 'settlements' && <SettlementsSection {...props} />}
        </div>
      </div>
    </div>
  );
}
