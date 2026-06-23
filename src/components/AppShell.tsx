'use client';

import Image from 'next/image';
import {
  BarChart2, ShoppingCart, Package, Receipt,
  Users, Warehouse, Settings, LogOut, Home,
  ChevronRight,
} from 'lucide-react';

export type TabId = 'dashboard' | 'pos' | 'products' | 'orders' | 'resellers' | 'stock' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
  { id: 'dashboard',  label: 'Analitik',    icon: <BarChart2  size={16} /> },
  { id: 'pos',        label: 'Kasir',        icon: <ShoppingCart size={16} /> },
  { id: 'products',   label: 'Produk',       icon: <Package    size={16} /> },
  { id: 'orders',     label: 'Pesanan',      icon: <Receipt    size={16} /> },
  { id: 'resellers',  label: 'Reseller',     icon: <Users      size={16} /> },
  { id: 'stock',      label: 'Gudang',       icon: <Warehouse  size={16} /> },
  { id: 'settings',   label: 'Pengaturan',   icon: <Settings   size={16} /> },
];

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://cemilantehrisma.vercel.app';

interface AppShellProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  onLogout: () => void;
  hasCart: boolean;
  cartCount: number;
  children: React.ReactNode;
  topbarActions?: React.ReactNode;
}

export default function AppShell({
  activeTab, setActiveTab, onLogout,
  hasCart, cartCount, children, topbarActions,
}: AppShellProps) {
  const currentTab = TABS.find(t => t.id === activeTab);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--ground)' }}>

      {/* ── Desktop Sidebar ──────────────────────────────────── */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 h-full overflow-hidden"
        style={{
          width: 228,
          background: 'var(--sidebar)',
          borderRight: '1px solid var(--sidebar-border)',
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
          <Image src="/icon-192.png" alt="logo" width={36} height={36} className="rounded-xl flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight text-white truncate">Cemilan Teh Risma</p>
            <p className="text-[11px] leading-tight" style={{ color: 'var(--sidebar-muted)' }}>Dashboard Admin</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto thin-scrollbar">
          <p className="section-label px-2 mb-3" style={{ color: 'var(--sidebar-muted)' }}>Menu</p>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`sidebar-nav-item w-full ${activeTab === tab.id ? 'active' : ''}`}
            >
              <span className="nav-icon flex-shrink-0" style={{ color: activeTab === tab.id ? 'var(--accent)' : 'var(--sidebar-muted)' }}>
                {tab.icon}
              </span>
              <span className="flex-1 text-left">{tab.label}</span>
              {tab.id === 'pos' && hasCart && (
                <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center flex-shrink-0">
                  {cartCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 space-y-1" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
          <a
            href={MAIN_APP}
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-nav-item w-full"
          >
            <span style={{ color: 'var(--sidebar-muted)' }}><Home size={15} /></span>
            <span>Lihat Toko</span>
            <ChevronRight size={12} style={{ color: 'var(--sidebar-muted)', marginLeft: 'auto' }} />
          </a>
          <button onClick={onLogout} className="sidebar-nav-item w-full">
            <span style={{ color: 'var(--danger)' }}><LogOut size={15} /></span>
            <span style={{ color: '#DC2626' }}>Keluar</span>
          </button>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">

        {/* Topbar */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-4 lg:px-6"
          style={{
            height: 56,
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border-2)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          {/* Left — mobile: logo + title, desktop: just title */}
          <div className="flex items-center gap-3">
            <Image src="/icon-192.png" alt="logo" width={28} height={28} className="rounded-lg flex-shrink-0 lg:hidden" />
            <div>
              <p className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
                {currentTab?.label ?? 'Dashboard'}
              </p>
              <p className="text-[11px] hidden lg:block" style={{ color: 'var(--text-muted)' }}>
                Cemilan Teh Risma
              </p>
            </div>
          </div>

          {/* Right — actions */}
          <div className="flex items-center gap-2">
            {topbarActions}
            {/* Mobile logout */}
            <button
              onClick={onLogout}
              className="lg:hidden p-2 rounded-xl transition-colors"
              style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        {/* Mobile tab strip */}
        <div
          className="lg:hidden flex-shrink-0 flex items-center gap-2 px-4 py-2.5 overflow-x-auto no-scrollbar"
          style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border-2)' }}
        >
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-chip ${activeTab === tab.id ? 'active' : ''}`}
            >
              {tab.icon}
              {tab.label}
              {tab.id === 'pos' && hasCart && activeTab !== 'pos' && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto thin-scrollbar">
          {children}
        </main>
      </div>
    </div>
  );
}
