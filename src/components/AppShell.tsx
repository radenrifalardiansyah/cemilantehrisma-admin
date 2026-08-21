'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronDown, MoreHorizontal, PanelLeftClose, PanelLeftOpen, LogOut, Home, Info, UserCog, Landmark, Receipt,
} from 'lucide-react';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import AboutModal from '@/components/AboutModal';
import EditProfileModal from '@/components/EditProfileModal';
import ChatWidget from '@/components/chat/ChatWidget';
import NotificationBell, { type NotificationDoc } from '@/components/NotificationBell';
import { NotificationsProvider } from '@/components/NotificationsProvider';
import { resolveIcon } from '@/lib/icon-registry';
import type { ModuleDoc, MenuDoc } from '@/types/rbac';

// The 26 fixed screens the app actually has code for (18 original tabs + 5
// RBAC-management tabs + Riwayat + Akun Storefront + Ulasan). Struktur Menu / Modul only
// control label, icon, order, nesting, and active-state for the sidebar — not which screens
// exist — so this stays a closed union, just a bigger one than before.
// 'admin-fee' is intentionally NOT driven by ModuleDoc/MenuDoc like the rest — it's RMedia's own
// internal billing tool, hardcoded to render only for `superAdmin` below, bypassing Struktur
// Menu / Hak Akses Role entirely so it can never be granted to any other role.
// 'tagihan-admin-fee' is the mirror image for `role === 'admin'`: the read/pay side of the same
// Biaya Admin invoices, also hardcoded (not a MenuDoc) so it can't be granted to staff/kasir/finance.
// 'notifications' is a normal feature like the rest — register a MenuDoc for it via Struktur Menu
// so it appears in the sidebar, and grant roles access to it via Hak Akses Role like any other tab.
// 'storefront-customers'/'reviews' read the STOREFRONT app's own Firestore collections
// (storefront_customers, reviews) — separate from this app's 'customers' (manual CRM contacts).
export type TabId =
  | 'dashboard' | 'pos' | 'products' | 'categories' | 'orders' | 'resellers' | 'customers'
  | 'storefront-customers' | 'reviews'
  | 'stock' | 'stock-report' | 'materials' | 'suppliers' | 'production' | 'consignment' | 'income' | 'expenses'
  | 'finance-report' | 'capital' | 'wallets' | 'settings'
  | 'users' | 'roles' | 'modules' | 'menus' | 'role-permissions' | 'history'
  | 'admin-fee' | 'tagihan-admin-fee' | 'notifications';

interface NavTab { id: TabId; label: string; Icon: LucideIcon; children?: NavTab[] }
interface NavGroup { id: string; label: string; Icon: LucideIcon; tabs: NavTab[] }

// Builds the sidebar tree from the dynamic `modules`/`menus` data (Struktur
// Menu / Modul) instead of a hardcoded array. `menus` is expected to already
// be permission-filtered by the caller (GET /api/menus) — AppShell just renders
// whatever it's given, sorted by `order`, nested one level via `parentId`.
function buildNavGroups(modules: ModuleDoc[], menus: MenuDoc[]): NavGroup[] {
  const toNavTab = (m: MenuDoc): NavTab => {
    const children = menus
      .filter(c => c.parentId === m.id)
      .sort((a, b) => a.order - b.order)
      .map(toNavTab);
    return {
      id: m.featureKey as TabId,
      label: m.label,
      Icon: resolveIcon(m.icon),
      children: children.length ? children : undefined,
    };
  };

  return modules
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(mod => ({
      id: mod.id,
      label: mod.name,
      Icon: resolveIcon(mod.icon),
      tabs: menus
        .filter(m => m.moduleId === mod.id && !m.parentId)
        .sort((a, b) => a.order - b.order)
        .map(toNavTab),
    }))
    .filter(g => g.tabs.length > 0);
}

// Preferred quick-access order for the mobile bottom nav; gracefully
// degrades to whatever's actually visible for a narrower role instead of
// assuming these 4 always exist.
const PREFERRED_PRIMARY_IDS: TabId[] = ['dashboard', 'pos', 'products', 'orders'];

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://cemilantehrisma.eleven-digital.id';

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
  superAdmin?: boolean;
  creds: string;
  role?: string;
  email?: string | null;
  avatar?: string | null;
  onProfileUpdated?: (patch: { email: string | null; avatar: string | null }) => void;
  modules: ModuleDoc[];
  menus: MenuDoc[];
  badges?: Partial<Record<TabId, number>>;
  onOpenNotification: (n: NotificationDoc) => void;
}

export default function AppShell({
  activeTab, setActiveTab, onLogout,
  hasCart, cartCount, children, topbarActions,
  username = 'Admin', superAdmin = false, creds, role = '', email = null, avatar = null,
  onProfileUpdated, modules, menus, badges = {}, onOpenNotification,
}: AppShellProps) {
  const [moreOpen,   setMoreOpen]   = useState(false);
  const [aboutOpen,  setAboutOpen]  = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [collapsed,  setCollapsed]  = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<TabId>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const confirm = useConfirm();

  const NAV_GROUPS  = buildNavGroups(modules, menus);
  const ALL_TABS     = NAV_GROUPS.flatMap(g => g.tabs.flatMap(t => t.children ? [t, ...t.children] : [t]));
  const preferred     = PREFERRED_PRIMARY_IDS.map(id => ALL_TABS.find(t => t.id === id)).filter((t): t is NavTab => !!t);
  const rest           = ALL_TABS.filter(t => !preferred.includes(t));
  const PRIMARY_TABS  = [...preferred, ...rest].slice(0, Math.min(4, ALL_TABS.length));
  const primaryIds     = new Set(PRIMARY_TABS.map(t => t.id));
  const MORE_TABS      = ALL_TABS.filter(t => !primaryIds.has(t.id));

  // Pinned outside NAV_GROUPS on purpose — see the TabId comment above.
  const SUPER_ADMIN_TAB: NavTab | null = superAdmin ? { id: 'admin-fee', label: 'Biaya Admin', Icon: Landmark } : null;
  const ADMIN_BILLING_TAB: NavTab | null = role === 'admin' ? { id: 'tagihan-admin-fee', label: 'Tagihan Biaya Admin', Icon: Receipt } : null;
  const PINNED_TAB = SUPER_ADMIN_TAB ?? ADMIN_BILLING_TAB;
  const MORE_TABS_DISPLAY = PINNED_TAB ? [...MORE_TABS, PINNED_TAB] : MORE_TABS;

  const handleLogout = async () => {
    if (await confirm({
      title: 'Konfirmasi Keluar',
      message: 'Yakin ingin keluar dari akun ini?',
      danger: true,
      confirmLabel: 'Keluar',
      onConfirm: async () => { await new Promise(r => setTimeout(r, 1200)); },
    })) {
      onLogout();
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('sb-collapsed');
    if (saved === 'true') setCollapsed(true);
    const savedGroups = localStorage.getItem('sb-group-collapsed');
    if (savedGroups) {
      try { setCollapsedGroups(new Set(JSON.parse(savedGroups))); } catch { /* ignore */ }
    }
  }, []);

  const toggleGroup = (label: string) => {
    setCollapsedGroups(s => {
      const next = new Set(s);
      next.has(label) ? next.delete(label) : next.add(label);
      localStorage.setItem('sb-group-collapsed', JSON.stringify([...next]));
      return next;
    });
  };

  const toggleCollapse = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem('sb-collapsed', String(next));
      return next;
    });
  };

  const currentTab   = ALL_TABS.find(t => t.id === activeTab) ?? (SUPER_ADMIN_TAB?.id === activeTab ? SUPER_ADMIN_TAB : undefined);
  const isMoreActive = MORE_TABS_DISPLAY.some(t => t.id === activeTab);
  const sw           = collapsed ? SIDEBAR_MINI : SIDEBAR_FULL;

  const go = (tab: TabId) => { setActiveTab(tab); setMoreOpen(false); };
  const toggleExpanded = (id: TabId) =>
    setExpandedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <NotificationsProvider creds={creds}>
    <div className="flex h-app-screen overflow-hidden" style={{ background: 'var(--ground)' }}>

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

          <div className="flex-shrink-0" style={{ zIndex: 1 }}>
            <Image
              src="/icon-192.png" alt="logo" width={34} height={34}
              className="rounded-xl"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}
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
          {NAV_GROUPS.map((group, gi) => {
            const groupCollapsed = !collapsed && collapsedGroups.has(group.label);
            return (
            <div key={group.id} className={gi > 0 ? 'mt-4' : ''}>
              {!collapsed && (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-3 mb-1.5"
                >
                  <span className="flex items-center gap-1.5">
                    <group.Icon size={12} style={{ color: 'rgba(138,98,72,0.85)' }} />
                    <span
                      className="text-[9.5px] font-bold uppercase tracking-[0.1em] whitespace-nowrap"
                      style={{ color: 'rgba(138,98,72,0.85)' }}
                    >
                      {group.label}
                    </span>
                  </span>
                  <ChevronDown
                    size={11}
                    style={{
                      color: 'rgba(138,98,72,0.85)', transition: 'transform 0.15s',
                      transform: groupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}
                  />
                </button>
              )}
              {collapsed && gi > 0 && (
                <div className="mx-auto mb-2 w-6" style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
              )}
              {!groupCollapsed && (
              <div className="space-y-0.5">
                {group.tabs.map(tab => {
                  const isActive     = activeTab === tab.id;
                  const hasChildren  = !!tab.children?.length;
                  const childActive  = tab.children?.some(c => c.id === activeTab) ?? false;
                  const isExpanded   = !collapsed && (expandedIds.has(tab.id) || childActive);
                  const navButton = (
                      <button
                        onClick={() => setActiveTab(tab.id)}
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
                        {!collapsed && tab.id !== 'pos' && (badges[tab.id] ?? 0) > 0 && (
                          <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center flex-shrink-0">
                            {badges[tab.id]}
                          </span>
                        )}
                        {collapsed && tab.id !== 'pos' && (badges[tab.id] ?? 0) > 0 && (
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
                  );
                  return (
                    <div key={tab.id}>
                      {collapsed
                        ? <Tooltip label={tab.label}>{navButton}</Tooltip>
                        : navButton}

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
              )}
            </div>
            );
          })}

          {/* Super Admin / Tagihan — pinned, not part of Struktur Menu (see TabId comment) */}
          {PINNED_TAB && (
            <div className="mt-4">
              {!collapsed && (
                <div className="px-3 mb-1.5">
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] whitespace-nowrap" style={{ color: 'rgba(255,144,144,0.7)' }}>
                    {SUPER_ADMIN_TAB ? 'Super Admin' : 'Tagihan'}
                  </span>
                </div>
              )}
              {collapsed && (
                <div className="mx-auto mb-2 w-6" style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
              )}
              <div className="space-y-0.5">
                {(() => {
                  const isActive = activeTab === PINNED_TAB.id;
                  const navButton = (
                    <button
                      onClick={() => setActiveTab(PINNED_TAB.id)}
                      className={`sidebar-nav-item w-full${isActive ? ' active' : ''}`}
                      style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                    >
                      <PINNED_TAB.Icon
                        size={17}
                        strokeWidth={isActive ? 2.2 : 1.7}
                        style={{ color: isActive ? '#F0C89A' : '#8A6248', flexShrink: 0 }}
                      />
                      {!collapsed && (
                        <span className="flex-1 text-left overflow-hidden whitespace-nowrap" style={{ color: isActive ? '#F0C89A' : '#EDD9C4' }}>
                          {PINNED_TAB.label}
                        </span>
                      )}
                    </button>
                  );
                  return collapsed ? <Tooltip label={PINNED_TAB.label}>{navButton}</Tooltip> : navButton;
                })()}
              </div>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div
          className="flex-shrink-0 px-2 pb-4 pt-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* Collapse toggle */}
          {(() => {
            const collapseButton = (
              <button
                onClick={toggleCollapse}
                className="sidebar-nav-item w-full mb-2"
                style={{ justifyContent: collapsed ? 'center' : 'flex-start', opacity: 0.6 }}
              >
                {collapsed
                  ? <PanelLeftOpen  size={14} style={{ color: '#8A6248', flexShrink: 0 }} />
                  : <PanelLeftClose size={14} style={{ color: '#8A6248', flexShrink: 0 }} />
                }
                {!collapsed && <span className="whitespace-nowrap text-xs" style={{ color: '#8A6248' }}>Perkecil</span>}
              </button>
            );
            return collapsed
              ? <Tooltip label="Perlebar menu" side="top">{collapseButton}</Tooltip>
              : collapseButton;
          })()}

          {/* User card — expanded */}
          {!collapsed && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 10,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Tooltip label="Edit profil" side="top">
                  <button
                    onClick={() => setProfileOpen(true)}
                    className="flex items-center w-full"
                    style={{ gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div className="relative" style={{ flexShrink: 0 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, overflow: 'hidden',
                        background: 'linear-gradient(135deg, #D4691E, #A84F10)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: 'white',
                        boxShadow: '0 2px 6px rgba(212,105,30,0.35)',
                      }}>
                        {avatar
                          ? <img src={avatar} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : username[0].toUpperCase()}
                      </div>
                      <span
                        className="status-dot-blink absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2"
                        style={{ borderColor: '#190C03' }}
                        title="Aktif"
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#EDD9C4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                        {username}
                      </p>
                      <p style={{ fontSize: 10, color: '#8A6248', lineHeight: 1.3 }}>{superAdmin ? 'Super Admin' : 'Administrator'}</p>
                    </div>
                  </button>
                </Tooltip>
              </div>
              <Tooltip label="Keluar" side="top">
                <button
                  onClick={handleLogout}
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
              </Tooltip>
            </div>
          )}

          {/* User card — collapsed: logout icon */}
          {collapsed && (
            <Tooltip label="Keluar" side="top">
              <button
                onClick={handleLogout}
                className="sidebar-nav-item w-full mt-0.5"
                style={{ justifyContent: 'center' }}
              >
                <LogOut size={15} style={{ color: '#FF9090', flexShrink: 0 }} />
              </button>
            </Tooltip>
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
            height: 'calc(60px + env(safe-area-inset-top))',
            paddingTop: 'env(safe-area-inset-top)',
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
            <div id="topbar-slot" className="flex items-center gap-2" />
            <NotificationBell creds={creds} username={username} onOpen={onOpenNotification} onViewAll={() => go('notifications')} />
            <a
              href={MAIN_APP} target="_blank" rel="noopener noreferrer"
              title="Lihat Toko"
              className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              <Home size={14} style={{ flexShrink: 0 }} />
              <span className="hidden sm:inline">Lihat Toko</span>
            </a>
            {topbarActions}
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
                  {tab.id !== 'pos' && (badges[tab.id] ?? 0) > 0 && (
                    <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                      {badges[tab.id]}
                    </span>
                  )}
                </span>
                <span
                  className="text-[10px] leading-none font-semibold"
                  style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                >
                  {tab.label}
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
          {MORE_TABS_DISPLAY.length > 0 && (() => {
            const moreBadgeTotal = MORE_TABS_DISPLAY.reduce((s, t) => s + (badges[t.id] ?? 0), 0);
            return (
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center justify-center gap-1 flex-1 relative pb-1"
            aria-label={isMoreActive ? (currentTab?.label ?? 'Lainnya') : 'Lainnya'}
          >
            <span className="relative">
            <MoreHorizontal
              size={21}
              strokeWidth={isMoreActive ? 2.2 : 1.6}
              style={{ color: isMoreActive ? 'var(--accent)' : 'var(--text-muted)' }}
            />
            {moreBadgeTotal > 0 && (
              <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                {moreBadgeTotal}
              </span>
            )}
            </span>
            <span
              className="text-[10px] leading-none font-semibold"
              style={{ color: isMoreActive ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {isMoreActive ? (currentTab?.label ?? 'Lainnya') : 'Lainnya'}
            </span>
            {isMoreActive && (
              <span
                className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            )}
          </button>
            );
          })()}
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
              <div className="grid grid-cols-4 gap-3">
                {MORE_TABS_DISPLAY.map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => go(tab.id)}
                      className="flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-2xl transition-all"
                      style={{
                        background: isActive ? 'var(--accent-bg)' : 'var(--surface-2)',
                        border: `1.5px solid ${isActive ? 'var(--accent-light)' : 'transparent'}`,
                      }}
                    >
                      <span className="relative">
                        <tab.Icon
                          size={22}
                          strokeWidth={isActive ? 2.5 : 1.8}
                          style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
                        />
                        {(badges[tab.id] ?? 0) > 0 && (
                          <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                            {badges[tab.id]}
                          </span>
                        )}
                      </span>
                      <span
                        className="text-[11px] font-semibold text-center leading-tight px-0.5"
                        style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
                      >
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 flex flex-col gap-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                <button
                  onClick={() => { setMoreOpen(false); setProfileOpen(true); }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                >
                  <UserCog size={20} strokeWidth={1.8} />
                  <span className="font-semibold text-sm">Edit Profil</span>
                </button>
                <button
                  onClick={() => { setMoreOpen(false); setAboutOpen(true); }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                >
                  <Info size={20} strokeWidth={1.8} />
                  <span className="font-semibold text-sm">Tentang Aplikasi</span>
                </button>
                <button
                  onClick={() => { setMoreOpen(false); handleLogout(); }}
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

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {profileOpen && (
        <EditProfileModal
          creds={creds}
          username={username}
          role={superAdmin ? 'Super Admin' : (role || 'Administrator')}
          email={email}
          avatar={avatar}
          onClose={() => setProfileOpen(false)}
          onSaved={patch => onProfileUpdated?.(patch)}
        />
      )}

      <ChatWidget username={username} creds={creds} avatar={avatar} />
    </div>
    </NotificationsProvider>
  );
}
