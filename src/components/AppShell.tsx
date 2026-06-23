'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  BarChart2, ShoppingCart, Package, Receipt,
  Users, Warehouse, Settings, LogOut, Home,
  ChevronRight, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

export type TabId = 'dashboard' | 'pos' | 'products' | 'orders' | 'resellers' | 'stock' | 'settings';

const NAV_GROUPS = [
  {
    label: 'Utama',
    tabs: [
      { id: 'dashboard' as TabId, label: 'Analitik',    mobileLabel: 'Analitik', Icon: BarChart2 },
      { id: 'pos'       as TabId, label: 'Kasir',        mobileLabel: 'Kasir',    Icon: ShoppingCart },
    ],
  },
  {
    label: 'Manajemen',
    tabs: [
      { id: 'products'  as TabId, label: 'Produk',       mobileLabel: 'Produk',   Icon: Package },
      { id: 'orders'    as TabId, label: 'Pesanan',      mobileLabel: 'Pesanan',  Icon: Receipt },
      { id: 'resellers' as TabId, label: 'Reseller',     mobileLabel: 'Reseller', Icon: Users },
    ],
  },
  {
    label: 'Operasional',
    tabs: [
      { id: 'stock'     as TabId, label: 'Gudang',       mobileLabel: 'Gudang',   Icon: Warehouse },
      { id: 'settings'  as TabId, label: 'Pengaturan',   mobileLabel: 'Setelan',  Icon: Settings },
    ],
  },
];

const ALL_TABS     = NAV_GROUPS.flatMap(g => g.tabs);
const PRIMARY_TABS = ALL_TABS.slice(0, 4);
const MORE_TABS    = ALL_TABS.slice(4);

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://cemilantehrisma.vercel.app';

const SIDEBAR_BG   = 'linear-gradient(175deg, #9B4418 0%, #7A3008 100%)';
const SIDEBAR_FULL = 240;
const SIDEBAR_MINI = 64;

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
  const [moreOpen,   setMoreOpen]   = useState(false);
  const [collapsed,  setCollapsed]  = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('sb-collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  const toggleCollapse = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem('sb-collapsed', String(next));
      return next;
    });
  };

  const currentTab   = ALL_TABS.find(t => t.id === activeTab);
  const isMoreActive = MORE_TABS.some(t => t.id === activeTab);
  const sw           = collapsed ? SIDEBAR_MINI : SIDEBAR_FULL;

  const go = (tab: TabId) => { setActiveTab(tab); setMoreOpen(false); };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--ground)' }}>

      {/* ═══ Desktop Sidebar ═══════════════════════════════════ */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 h-full"
        style={{
          width: sw,
          minWidth: sw,
          background: SIDEBAR_BG,
          boxShadow: '4px 0 24px rgba(0,0,0,0.14)',
          transition: 'width 0.26s cubic-bezier(0.4,0,0.2,1), min-width 0.26s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Brand */}
        <div
          className="flex-shrink-0 flex items-center px-3 pt-5 pb-4"
          style={{
            height: 72,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            paddingLeft: collapsed ? 0 : 16,
            transition: 'gap 0.26s, padding 0.26s',
          }}
        >
          <div className="relative flex-shrink-0">
            <Image
              src="/icon-192.png" alt="logo" width={36} height={36}
              className="rounded-xl"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
            />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2"
              style={{ borderColor: '#7A3008' }}
            />
          </div>
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="text-[13px] font-extrabold leading-tight truncate" style={{ color: '#FDECD0' }}>
                Cemilan Teh Risma
              </p>
              <p className="text-[10.5px] mt-0.5 font-medium truncate" style={{ color: '#D49060' }}>
                Admin Dashboard
              </p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: 'none' }}>
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? 'mt-4' : ''}>
              {!collapsed && (
                <p
                  className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] whitespace-nowrap"
                  style={{ color: 'rgba(212,144,96,0.7)' }}
                >
                  {group.label}
                </p>
              )}
              {collapsed && gi > 0 && (
                <div className="mx-auto mb-2 w-6" style={{ height: 1, background: 'rgba(255,255,255,0.12)' }} />
              )}
              <div className="space-y-0.5">
                {group.tabs.map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      title={collapsed ? tab.label : undefined}
                      className={`sidebar-nav-item w-full${isActive ? ' active' : ''}`}
                      style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                    >
                      <tab.Icon
                        size={17}
                        strokeWidth={isActive ? 2.5 : 1.8}
                        style={{ color: isActive ? '#FDE68A' : '#D49060', flexShrink: 0 }}
                      />
                      {!collapsed && (
                        <span className="flex-1 text-left overflow-hidden whitespace-nowrap" style={{ color: isActive ? '#FFFFFF' : '#FDECD0' }}>
                          {tab.label}
                        </span>
                      )}
                      {!collapsed && tab.id === 'pos' && hasCart && (
                        <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center flex-shrink-0">
                          {cartCount}
                        </span>
                      )}
                      {collapsed && tab.id === 'pos' && hasCart && (
                        <span
                          className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div
          className="flex-shrink-0 px-2 pb-4 pt-2 space-y-0.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
        >
          <a
            href={MAIN_APP} target="_blank" rel="noopener noreferrer"
            title={collapsed ? 'Lihat Toko' : undefined}
            className="sidebar-nav-item w-full"
            style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            <Home size={15} style={{ color: '#D49060', flexShrink: 0 }} />
            {!collapsed && (
              <>
                <span className="flex-1 text-left whitespace-nowrap overflow-hidden" style={{ color: '#FDECD0' }}>Lihat Toko</span>
                <ChevronRight size={11} style={{ color: '#D49060', flexShrink: 0 }} />
              </>
            )}
          </a>
          <button
            onClick={onLogout}
            title={collapsed ? 'Keluar' : undefined}
            className="sidebar-nav-item w-full"
            style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            <LogOut size={15} style={{ color: '#FF9090', flexShrink: 0 }} />
            {!collapsed && <span className="whitespace-nowrap" style={{ color: '#FF9090' }}>Keluar</span>}
          </button>

          {/* Collapse toggle */}
          <button
            onClick={toggleCollapse}
            title={collapsed ? 'Perlebar menu' : 'Perkecil menu'}
            className="sidebar-nav-item w-full mt-1"
            style={{ justifyContent: collapsed ? 'center' : 'flex-start', opacity: 0.7 }}
          >
            {collapsed
              ? <PanelLeftOpen  size={14} style={{ color: '#D49060', flexShrink: 0 }} />
              : <PanelLeftClose size={14} style={{ color: '#D49060', flexShrink: 0 }} />
            }
            {!collapsed && <span className="whitespace-nowrap text-xs" style={{ color: '#D49060' }}>Perkecil</span>}
          </button>
        </div>
      </aside>

      {/* ═══ Main Area ═════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">

        {/* Topbar */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-4 lg:px-6"
          style={{
            height: 58,
            background: 'rgba(255,255,255,0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderBottom: '1px solid var(--border-2)',
            boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
          }}
        >
          <div className="flex items-center gap-3">
            <Image src="/icon-192.png" alt="logo" width={30} height={30} className="rounded-xl flex-shrink-0 lg:hidden" />
            {/* Desktop: show collapse toggle only when fully collapsed and sidebar visible */}
            <div className="hidden lg:flex items-center gap-3">
              <div>
                <p className="text-[15px] font-extrabold leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {currentTab?.label ?? 'Dashboard'}
                </p>
                <p className="text-[11px] leading-tight mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Cemilan Teh Risma · Admin
                </p>
              </div>
            </div>
            <div className="lg:hidden">
              <p className="text-[15px] font-extrabold leading-tight" style={{ color: 'var(--text-primary)' }}>
                {currentTab?.label ?? 'Dashboard'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {topbarActions}
            <button
              onClick={onLogout}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto thin-scrollbar mobile-content-pad">
          {children}
        </main>
      </div>

      {/* ═══ Mobile Bottom Navigation ══════════════════════════ */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30"
        style={{
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderTop: '1px solid var(--border-2)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.07)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex items-stretch h-16">
          {PRIMARY_TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => go(tab.id)}
                className="flex flex-col items-center justify-center gap-1 flex-1 relative pt-1"
              >
                {isActive && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
                <span className="relative">
                  <tab.Icon
                    size={22}
                    strokeWidth={isActive ? 2.5 : 1.6}
                    style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                  />
                  {tab.id === 'pos' && hasCart && (
                    <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                      {cartCount}
                    </span>
                  )}
                </span>
                <span
                  className="text-[10px] leading-none font-semibold"
                  style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                >
                  {tab.mobileLabel}
                </span>
              </button>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center justify-center gap-1 flex-1 relative pt-1"
          >
            {isMoreActive && (
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full"
                style={{ background: 'var(--accent)' }}
              />
            )}
            <MoreHorizontal
              size={22}
              strokeWidth={isMoreActive ? 2.5 : 1.6}
              style={{ color: isMoreActive ? 'var(--accent)' : 'var(--text-muted)' }}
            />
            <span
              className="text-[10px] leading-none font-semibold"
              style={{ color: isMoreActive ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {isMoreActive ? (currentTab?.mobileLabel ?? 'Lainnya') : 'Lainnya'}
            </span>
          </button>
        </div>
      </nav>

      {/* ═══ More Bottom Sheet ═════════════════════════════════ */}
      {moreOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.38)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="lg:hidden fixed left-0 right-0 z-50 animate-slide-up"
            style={{
              bottom: 0,
              background: 'var(--surface)',
              borderRadius: '24px 24px 0 0',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.14)',
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
            }}
          >
            <div className="flex justify-center pt-3 pb-5">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>

            <div className="px-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--text-muted)' }}>
                Menu Lainnya
              </p>
              <div className="space-y-1.5">
                {MORE_TABS.map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => go(tab.id)}
                      className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all"
                      style={{
                        background: isActive ? 'var(--accent-bg)' : 'var(--surface-2)',
                        border: `1.5px solid ${isActive ? 'var(--accent-light)' : 'transparent'}`,
                      }}
                    >
                      <tab.Icon
                        size={20}
                        strokeWidth={isActive ? 2.5 : 1.8}
                        style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
                      />
                      <span
                        className="font-semibold text-sm flex-1 text-left"
                        style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
                      >
                        {tab.label}
                      </span>
                      {isActive && <ChevronRight size={15} style={{ color: 'var(--accent)' }} />}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-2)' }}>
                <button
                  onClick={() => { setMoreOpen(false); onLogout(); }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
                  style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
                >
                  <LogOut size={20} strokeWidth={1.8} />
                  <span className="font-semibold text-sm">Keluar</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
