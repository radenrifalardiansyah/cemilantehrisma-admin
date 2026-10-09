'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLoader from '@/components/PageLoader';
import type { Action } from '@/types/rbac';
import {
  API, type TitipJualData, type Stall, type Consignor, type CProduct, type StallItem, type Warehouse,
} from './titip-jual/shared';
import ProductsSection from './titip-jual/ProductsSection';
import ConsignorsSection from './titip-jual/ConsignorsSection';
import StallsSection from './titip-jual/StallsSection';
import StockSection from './titip-jual/StockSection';
import ReceiptsSection from './titip-jual/ReceiptsSection';

type SubTab = 'products' | 'consignors' | 'stalls' | 'stock' | 'receipts';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'products', label: 'Produk' },
  { id: 'consignors', label: 'Penitip' },
  { id: 'stalls', label: 'Lapak' },
  { id: 'stock', label: 'Stok per Lapak' },
  { id: 'receipts', label: 'Terima & Retur' },
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
  const [s, c, p, w] = await Promise.all([
    json<{ stalls: Stall[] }>('/api/stalls', { stalls: [] }),
    json<{ consignors: Consignor[] }>('/api/consignors', { consignors: [] }),
    json<{ products: CProduct[]; stallItems: StallItem[] }>('/api/consign/products', { products: [], stallItems: [] }),
    json<{ warehouses: Warehouse[] }>('/api/warehouses', { warehouses: [] }),
  ]);
  return { stalls: s.stalls, consignors: c.consignors, products: p.products, stallItems: p.stallItems, warehouses: w.warehouses };
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

  const props = { creds, data, reload: load, can: (a: 'view' | 'create' | 'edit' | 'delete') => can(a) };

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`${sub === t.id ? 'btn-primary' : 'btn-ghost'} text-xs flex-shrink-0 whitespace-nowrap`} style={{ height: 34 }}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'products' && <ProductsSection {...props} />}
      {sub === 'consignors' && <ConsignorsSection {...props} />}
      {sub === 'stalls' && <StallsSection {...props} />}
      {sub === 'stock' && <StockSection {...props} />}
      {sub === 'receipts' && <ReceiptsSection {...props} />}
    </div>
  );
}
