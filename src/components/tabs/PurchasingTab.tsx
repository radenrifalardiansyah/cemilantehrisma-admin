'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, PackageCheck, RefreshCw } from 'lucide-react';
import PurchaseFlowPanel, { type FlowMaterial, type FlowSupplier } from '@/components/tabs/PurchaseFlowPanel';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';

// Menu PO & GR (dulu sub-tab di Bahan Baku). Memuat bahan baku, supplier, dompet & header toko
// sekali untuk PurchaseFlowPanel; daftar PO/GR dimuat panel itu sendiri.

type View = 'po' | 'gr';
const VIEWS: { id: View; label: string; Icon: React.ElementType }[] = [
  { id: 'po', label: 'Purchase Order', Icon: ClipboardList },
  { id: 'gr', label: 'Penerimaan (GR)', Icon: PackageCheck },
];

export default function PurchasingTab({ creds, canApprove }: { creds: string; canApprove: boolean }) {
  const storeHeader = useStoreHeader(creds);
  const wallets = useWallets(creds);
  const [walletBalances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

  const [view, setView] = useState<View>('po');
  const [materials, setMaterials] = useState<FlowMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<FlowSupplier[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [mRes, sRes] = await Promise.all([
      fetch('/api/materials', { headers: { 'x-admin-auth': creds } }),
      fetch('/api/suppliers', { headers: { 'x-admin-auth': creds } }),
    ]);
    if (mRes.ok) setMaterials((await mRes.json() as { materials: FlowMaterial[] }).materials);
    if (sRes.ok) setSuppliers((await sRes.json() as { suppliers: FlowSupplier[] }).suppliers);
    setLoading(false);
  }, [creds]);
  useEffect(() => { load(); }, [load]);

  if (loading && materials.length === 0 && suppliers.length === 0) return <PageLoader />;

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={() => { load(); refetchBalances(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="inline-flex max-w-full rounded-xl overflow-x-auto no-scrollbar border" style={{ borderColor: 'var(--border)' }}>
          {VIEWS.map(t => (
            <button key={t.id} onClick={() => setView(t.id)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all whitespace-nowrap flex-shrink-0"
              style={view === t.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
              <t.Icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <PurchaseFlowPanel
          creds={creds}
          view={view}
          onSwitchView={setView}
          materials={materials}
          suppliers={suppliers}
          walletOptions={walletOptions}
          walletBalances={walletBalances}
          storeHeader={storeHeader}
          canApprove={canApprove}
          onStockChanged={() => { load(); refetchBalances(); }}
        />
      </div>
    </div>
  );
}
