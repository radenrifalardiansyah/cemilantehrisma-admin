'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart2, ShoppingCart, Package, Receipt, Tag,
  Users, Contact, Warehouse, Settings, LogOut, Home,
  ChevronRight, ChevronDown, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

export type TabId = 'dashboard' | 'pos' | 'products' | 'categories' | 'orders' | 'resellers' | 'customers' | 'stock' | 'settings';

interface NavTab {
  id: TabId; label: string; mobileLabel: string; Icon: LucideIcon;
  children?: NavTab[];
}

const NAV_GROUPS: { label: string; tabs: NavTab[] }[] = [
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
      {
        id: 'products' as TabId, label: 'Produk', mobileLabel: 'Produk', Icon: Package,
        children: [
          { id: 'categories' as TabId, label: 'Kategori', mobileLabel: 'Kategori', Icon: Tag },
        ],
      },
      { id: 'orders'     as TabId, label: 'Pesanan',      mobileLabel: 'Pesanan',  Icon: Receipt },
      { id: 'resellers'  as TabId, label: 'Reseller',     mobileLabel: 'Reseller', Icon: Users },
      { id: 'customers'  as TabId, label: 'Pelanggan',    mobileLabel: 'Pelanggan', Icon: Contact },
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

// Flattened (parents + their children) — used for lookups like the topbar
// title and "is this tab active" checks, regardless of nesting in the sidebar.
const ALL_TABS = NAV_GROUPS.flatMap(g => g.tabs.flatMap(t => t.children ? [t, ...t.children] : [t]));
// Fixed set (not a positional slice) so inserting new tabs into NAV_GROUPS
// doesn't silently reshuffle which 4 tabs get mobile bottom-nav quick access.
const PRIMARY_IDS: TabId[] = ['dashboard', 'pos', 'products', 'orders'];
const PRIMARY_TABS = PRIMARY_IDS.map(id => ALL_TABS.find(t => t.id === id)!);
const MORE_TABS    = ALL_TABS.filter(t => !PRIMARY_IDS.includes(t.id));

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://cemilantehrisma.vercel.app';

const SIDEBAR_BG   = '#190C03';
const SIDEBAR_FULL = 256;
const SIDEBAR_MINI = 64;

interface AppShellProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  onLogout: () => void;
  hasCart: boolean;
  cartCount: number;
  children: React.ReactNode;
  topbarActions?: React.ReactNode;
  username?: string;
}

export default function AppShell({
  activeTab, setActiveTab, onLogout,
  hasCart, cartCount, children, topbarActions,
  username = 'Admin',
}: AppShellProps) {
  const [moreOpen,   setMoreOpen]   = useState(false);
  const [collapsed,  setCollapsed]  = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<TabId>>(new Set());

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
  const toggleExpanded = (id: TabId) =>
    setExpandedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--ground)' }}>

      {/* ═══ Desktop Sidebar ═══════════════════════════════════ */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 h-full sidebar-texture"
        style={{
          width: sw,
          minWidth: sw,
          background: SIDEBAR_BG,
          boxShadow: '4px 0 20px rgba(0,0,0,0.18)',
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
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            paddingLeft: collapsed ? 0 : 16,
            transition: 'gap 0.26s, padding 0.26s',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Ambient glow */}
          <div style={{
            position: 'absolute', top: -28, left: -28,
            width: 150, height: 150, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(212,105,30,0.20) 0%, transparent 68%)',
            pointerEvents: 'none', zIndex: 0,
          }} />

          <div className="relative flex-shrink-0" style={{ zIndex: 1 }}>
            <Image
              src="/icon-192.png" alt="logo" width={34} height={34}
              className="rounded-xl"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}
            />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2"
              style={{ borderColor: '#190C03' }}
            />
          </div>
          {!collapsed && (
            <div className="min-w-0 overflow-hidden" style={{ zIndex: 1 }}>
              <p className="text-[13px] font-extrabold leading-tight truncate" style={{ color: '#EDD9C4' }}>
                Cemilan Teh Risma
              </p>
              <p className="text-[10px] mt-0.5 font-semibold truncate tracking-wide uppercase" style={{ color: '#8A6248' }}>
                Admin Panel
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
                  className="px-3 mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.1em] whitespace-nowrap"
                  style={{ color: 'rgba(138,98,72,0.85)' }}
                >
                  {group.label}
                </p>
              )}
              {collapsed && gi > 0 && (
                <div className="mx-auto mb-2 w-6" style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
              )}
              <div className="space-y-0.5">
                {group.tabs.map(tab => {
                  const isActive     = activeTab === tab.id;
                  const hasChildren  = !!tab.children?.length;
                  const childActive  = tab.children?.some(c => c.id === activeTab) ?? false;
                  const isExpanded   = !collapsed && (expandedIds.has(tab.id) || childActive);
                  return (
                    <div key={tab.id}>
                      <button
                        onClick={() => setActiveTab(tab.id)}
                        title={collapsed ? tab.label : undefined}
                        className={`sidebar-nav-item w-full${isActive ? ' active' : ''}`}
                        style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                      >
                        <tab.Icon
                          size={17}
                          strokeWidth={isActive ? 2.2 : 1.7}
                          style={{ color: isActive ? '#F0C89A' : '#8A6248', flexShrink: 0 }}
                        />
                        {!collapsed && (
                          <span className="flex-1 text-left overflow-hidden whitespace-nowrap" style={{ color: isActive ? '#F0C89A' : '#EDD9C4' }}>
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
                        {!collapsed && hasChildren && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={e => { e.stopPropagation(); toggleExpanded(tab.id); }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleExpanded(tab.id); } }}
                            className="flex-shrink-0 p-0.5"
                          >
                            <ChevronDown
                              size={13}
                              style={{
                                color: '#8A6248', transition: 'transform 0.15s',
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                              }}
                            />
                          </span>
                        )}
                      </button>

                      {isExpanded && (
                        <div className="mt-0.5 space-y-0.5" style={{ paddingLeft: 29 }}>
                          {tab.children!.map(child => {
                            const childIsActive = activeTab === child.id;
                            return (
                              <button
                                key={child.id}
                                onClick={() => setActiveTab(child.id)}
                                className={`sidebar-nav-item w-full${childIsActive ? ' active' : ''}`}
                                style={{ justifyContent: 'flex-start' }}
                              >
                                <child.Icon
                                  size={15}
                                  strokeWidth={childIsActive ? 2.2 : 1.7}
                                  style={{ color: childIsActive ? '#F0C89A' : '#8A6248', flexShrink: 0 }}
                                />
                                <span className="flex-1 text-left overflow-hidden whitespace-nowrap" style={{ color: childIsActive ? '#F0C89A' : '#EDD9C4' }}>
                                  {child.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div
          className="flex-shrink-0 px-2 pb-4 pt-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <a
            href={MAIN_APP} target="_blank" rel="noopener noreferrer"
            title={collapsed ? 'Lihat Toko' : undefined}
            className="sidebar-nav-item w-full"
            style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            <Home size={15} style={{ color: '#8A6248', flexShrink: 0 }} />
            {!collapsed && (
              <>
                <span className="flex-1 text-left whitespace-nowrap overflow-hidden" style={{ color: '#EDD9C4' }}>Lihat Toko</span>
                <ChevronRight size={11} style={{ color: '#8A6248', flexShrink: 0 }} />
              </>
            )}
          </a>

          {/* Collapse toggle */}
          <button
            onClick={toggleCollapse}
            title={collapsed ? 'Perlebar menu' : 'Perkecil menu'}
            className="sidebar-nav-item w-full mb-2"
            style={{ justifyContent: collapsed ? 'center' : 'flex-start', opacity: 0.6 }}
          >
            {collapsed
              ? <PanelLeftOpen  size={14} style={{ color: '#8A6248', flexShrink: 0 }} />
              : <PanelLeftClose size={14} style={{ color: '#8A6248', flexShrink: 0 }} />
            }
            {!collapsed && <span className="whitespace-nowrap text-xs" style={{ color: '#8A6248' }}>Perkecil</span>}
          </button>

          {/* User card — expanded */}
          {!collapsed && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 10,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: 'linear-gradient(135deg, #D4691E, #A84F10)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, color: 'white',
                boxShadow: '0 2px 6px rgba(212,105,30,0.35)',
              }}>
                {username[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#EDD9C4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                  {username}
                </p>
                <p style={{ fontSize: 10, color: '#8A6248', lineHeight: 1.3 }}>Administrator</p>
              </div>
              <button
                onClick={onLogout}
                title="Keluar"
                style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  background: 'rgba(255,144,144,0.08)', border: '1px solid rgba(255,144,144,0.15)',
                  color: '#FF9090', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,144,144,0.20)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,144,144,0.08)')}
              >
                <LogOut size={13} />
              </button>
            </div>
          )}

          {/* User card — collapsed: logout icon */}
          {collapsed && (
            <button
              onClick={onLogout}
              title="Keluar"
              className="sidebar-nav-item w-full mt-0.5"
              style={{ justifyContent: 'center' }}
            >
              <LogOut size={15} style={{ color: '#FF9090', flexShrink: 0 }} />
            </button>
          )}
        </div>
      </aside>

      {/* ═══ Main Area ═════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden"
        style={{ '--sidebar-w': `${sw}px` } as React.CSSProperties}>

        {/* Topbar */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-4 lg:px-6"
          style={{
            height: 60,
            background: '#FFFFFF',
            borderBottom: '1px solid var(--border)',
            boxShadow: '0 1px 0 var(--border-2)',
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
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
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
          background: '#FFFFFF',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -4px 16px rgba(30,16,8,0.07)',
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
                className="flex flex-col items-center justify-center gap-1 flex-1 relative pb-1"
              >
                <span className="relative">
                  <tab.Icon
                    size={21}
                    strokeWidth={isActive ? 2.2 : 1.6}
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
                {isActive && (
                  <span
                    className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
              </button>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center justify-center gap-1 flex-1 relative pb-1"
          >
            <MoreHorizontal
              size={21}
              strokeWidth={isMoreActive ? 2.2 : 1.6}
              style={{ color: isMoreActive ? 'var(--accent)' : 'var(--text-muted)' }}
            />
            <span
              className="text-[10px] leading-none font-semibold"
              style={{ color: isMoreActive ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {isMoreActive ? (currentTab?.mobileLabel ?? 'Lainnya') : 'Lainnya'}
            </span>
            {isMoreActive && (
              <span
                className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            )}
          </button>
        </div>
      </nav>

      {/* ═══ More Bottom Sheet ═════════════════════════════════ */}
      {moreOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40"
            style={{ background: 'rgba(30,16,8,0.4)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="lg:hidden fixed left-0 right-0 z-50 animate-slide-up"
            style={{
              bottom: 0,
              background: 'var(--surface)',
              borderRadius: '20px 20px 0 0',
              boxShadow: '0 -8px 40px rgba(30,16,8,0.14)',
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
