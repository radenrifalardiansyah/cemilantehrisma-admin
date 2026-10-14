'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import PurchaseFlowPanel, { type FlowMaterial, type FlowSupplier } from '@/components/tabs/PurchaseFlowPanel';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { useWallets, useWalletBalances, activeWalletOptions } from '@/lib/useWallets';

// Menu Purchase Order (PO) dan Goods Receipt (GR) — dua menu terpisah, satu komponen (`view`).
// Memuat bahan baku, supplier, dompet & header toko sekali untuk PurchaseFlowPanel; daftar PO/GR
// dimuat panel itu sendiri.
export default function PurchaseFlowTab({ creds, view, canApprove, onGoto, openGrId, onOpenGrHandled }: {
  creds: string; view: 'po' | 'gr'; canApprove: boolean;
  onGoto: (v: 'po' | 'gr', grId?: string) => void;
  openGrId?: string | null; onOpenGrHandled?: () => void;
}) {
  const storeHeader = useStoreHeader(creds);
  const wallets = useWallets(creds);
  const [walletBalances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = activeWalletOptions(wallets, walletBalances);

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
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <PurchaseFlowPanel
          creds={creds}
          view={view}
          onGoto={onGoto}
          openGrId={openGrId}
          onOpenGrHandled={onOpenGrHandled}
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
