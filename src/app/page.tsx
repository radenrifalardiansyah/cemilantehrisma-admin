'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  RefreshCw, MessageCircle, TrendingUp, Receipt, Package, Users,
  Loader2,
  Eye, EyeOff, Smartphone, Monitor, BarChart2, Globe, Award,
  MousePointerClick, Tag, ShoppingCart,
} from 'lucide-react';
import AppShell, { TabId } from '@/components/AppShell';
import TopbarPortal from '@/components/TopbarPortal';
import ProductsTab   from '@/components/tabs/ProductsTab';
import CategoriesTab from '@/components/tabs/CategoriesTab';
import OrdersTab    from '@/components/tabs/OrdersTab';
import ResellersTab from '@/components/tabs/ResellersTab';
import CustomersTab from '@/components/tabs/CustomersTab';
import StockTab     from '@/components/tabs/StockTab';
import SuppliersTab  from '@/components/tabs/SuppliersTab';
import MaterialsTab  from '@/components/tabs/MaterialsTab';
import ProductionTab from '@/components/tabs/ProductionTab';
import ConsignmentTab from '@/components/tabs/ConsignmentTab';
import ExpensesTab   from '@/components/tabs/ExpensesTab';
import FinanceReportTab from '@/components/tabs/FinanceReportTab';
import CapitalTab from '@/components/tabs/CapitalTab';
import SettingsTab  from '@/components/tabs/SettingsTab';
import PosTab from '@/components/tabs/PosTab';
import type { PosProduct, PosCategory_Entry, PosReseller, PosBank, PosCustomer } from '@/lib/pos-types';

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://cemilantehrisma.vercel.app';

// ─── Types & helpers ──────────────────────────────────────────────────────────
interface DashOrder { customerName: string; total: number; date: string; }
interface TopProduct { name: string; emoji: string; bgColor: string; stock: string; count: number; }
interface WebStats {
  visitors: number; pageViews: number;
  mobile: number; desktop: number;
  daily: { date: string; views: number; visitors: number }[];
  topPages: { path: string; visitors: number }[];
  topMenu: { path: string; count: number }[];
  topCategories: { id: string; name: string; emoji: string; count: number }[];
  topProducts: { id: string; name: string; emoji: string; bgColor: string; clicks: number; addToCart: number }[];
}
interface DashData {
  orderCount: number; revenue: number;
  productCount: number; resellerCount: number;
  recentOrders: DashOrder[];
  revenueTrend: { date: string; revenue: number; count: number }[];
  topProducts: TopProduct[];
  webStats: WebStats | null;
  webStatsErr: string;
}

const PAGE_LABELS: Record<string, string> = {
  '/': 'Beranda', '/products': 'Produk', '/reseller': 'Reseller',
  '/panduan': 'Panduan', '/kontak': 'Kontak', '/checkout': 'Checkout',
};
const pageLabel = (p: string) => PAGE_LABELS[p] ?? p;

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

// ─── Revenue Chart — smooth bezier line + hover tooltip ──────────────────────
function RevenueChart({ data }: { data: { date: string; revenue: number; count: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = data.length;
  if (n === 0) return null;

  const VW = 560, VH = 128;
  const PAD = { l: 6, r: 6, t: 22, b: 28 };
  const iW = VW - PAD.l - PAD.r;
  const iH = VH - PAD.t - PAD.b;
  const maxVal = Math.max(...data.map(d => d.revenue), 1);

  const pts = data.map((d, i) => ({
    x: PAD.l + (n === 1 ? iW / 2 : (i / (n - 1)) * iW),
    y: PAD.t + (1 - d.revenue / maxVal) * iH,
    revenue: d.revenue, date: d.date, count: d.count,
  }));

  const linePath = n < 2 ? '' : pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x},${pt.y}`;
    const prev = pts[i - 1];
    return `${acc} C ${prev.x + (pt.x - prev.x) * 0.45},${prev.y} ${prev.x + (pt.x - prev.x) * 0.55},${pt.y} ${pt.x},${pt.y}`;
  }, '');

  const fillPath = linePath
    ? `${linePath} L ${pts[n-1].x},${PAD.t + iH} L ${pts[0].x},${PAD.t + iH} Z`
    : '';

  const lastPt = pts[n - 1];
  const hPt = hoverIdx !== null ? pts[hoverIdx] : null;
  const step = n > 14 ? 3 : n > 7 ? 2 : 1;

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * VW;
          let ci = 0, md = Infinity;
          pts.forEach((pt, i) => { const d = Math.abs(pt.x - relX); if (d < md) { md = d; ci = i; } });
          setHoverIdx(ci);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#D4691E" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#D4691E" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {fillPath && <path d={fillPath} fill="url(#rev-fill)" />}
        {linePath && <path d={linePath} fill="none" stroke="#D4691E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

        {/* Single point */}
        {n === 1 && <circle cx={lastPt.x} cy={lastPt.y} r="5" fill="#D4691E" stroke="white" strokeWidth="2" />}

        {/* Hover dashed vertical */}
        {hPt && (
          <line x1={hPt.x} y1={PAD.t} x2={hPt.x} y2={PAD.t + iH}
            stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4,3" />
        )}

        {/* Hover dot */}
        {hPt && <circle cx={hPt.x} cy={hPt.y} r="5" fill="#D4691E" stroke="white" strokeWidth="2.5" />}

        {/* Endpoint pulse (hari ini) */}
        {n > 1 && hoverIdx !== n - 1 && (
          <>
            <circle cx={lastPt.x} cy={lastPt.y} r="10" fill="#D4691E" opacity="0.10" />
            <circle cx={lastPt.x} cy={lastPt.y} r="4.5" fill="#D4691E" stroke="white" strokeWidth="2" />
          </>
        )}

        {/* X-axis labels */}
        {pts.map((pt, i) => {
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text key={i} x={pt.x} y={VH - 4} textAnchor="middle" fontSize="9" fill="#A08468">
              {shortDate(pt.date)}
            </text>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hPt && hPt.revenue > 0 && (
        <div style={{
          position: 'absolute',
          left: `${(hPt.x / VW) * 100}%`,
          top: `${(hPt.y / VH) * 100}%`,
          transform: 'translate(-50%, calc(-100% - 10px))',
          background: 'var(--text-primary)',
          color: 'white',
          padding: '5px 10px',
          borderRadius: 8,
          fontSize: 11, fontWeight: 700,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          zIndex: 10,
        }}>
          {formatRp(hPt.revenue)}
          {hPt.count > 0 && <span style={{ opacity: 0.6, marginLeft: 5, fontSize: 10 }}>{hPt.count}x</span>}
        </div>
      )}
    </div>
  );
}

// ─── Pageview Chart ───────────────────────────────────────────────────────────
function shortDate(raw: string) {
  try {
    const dt = new Date(raw);
    if (!isNaN(dt.getTime()))
      return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  } catch {}
  const p = raw.split(/[\s-]/);
  return p.length >= 2 ? `${p[p.length - 1]} ${p[1]?.slice(0, 3) ?? ''}`.trim() : raw.slice(0, 5);
}

function PageviewChart({ data }: { data: { date: string; views: number }[] }) {
  const maxVal = Math.max(...data.map(d => d.views), 1);
  const n = data.length;
  const W = 28, GAP = 10, H = 72, LH = 22;
  const totalW = n * (W + GAP) - GAP;
  const step = n > 14 ? 3 : n > 7 ? 2 : 1;
  return (
    <div className="no-scrollbar" style={{ overflowX: 'auto', paddingBottom: 2 }}>
      <svg width={totalW} height={H + LH} style={{ display: 'block', overflow: 'visible' }}>
        {data.map((d, i) => {
          const barH = Math.max((d.views / maxVal) * H, d.views > 0 ? 5 : 2);
          const x = i * (W + GAP);
          const isToday = i === n - 1;
          const showLabel = i % step === 0 || i === n - 1;
          return (
            <g key={i}>
              <rect x={x} y={H - barH} width={W} height={barH} rx="5"
                fill={isToday ? '#0284C7' : '#0284C720'} />
              {d.views > 0 && (
                <text x={x + W / 2} y={H - barH - 4} textAnchor="middle" fontSize="9"
                  fill={isToday ? '#075985' : '#9E8E72'} fontWeight="700">
                  {d.views}
                </text>
              )}
              {showLabel && (
                <text x={x + W / 2} y={H + LH - 3} textAnchor="middle" fontSize="8.5" fill="#9E8E72">
                  {shortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Top-N interactive bar list (hover to highlight + tooltip) ───────────────
interface TopListItem { label: string; value: number; emoji?: string; sub?: string }
function TopListChart({ items, color }: { items: TopListItem[]; color: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="space-y-3.5">
      {items.map((it, i) => {
        const pct = Math.round((it.value / max) * 100);
        const active = hoverIdx === i;
        return (
          <div key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-xs font-semibold flex items-center gap-1.5 truncate min-w-0"
                style={{ color: active ? color : 'var(--text-secondary)' }}>
                {it.emoji && <span className="flex-shrink-0">{it.emoji}</span>}
                <span className="truncate">{it.label}</span>
              </span>
              <span className="text-xs font-bold tabular flex-shrink-0" style={{ color: active ? color : 'var(--text-primary)' }}>
                {it.value.toLocaleString('id')}{it.sub ? <span className="font-medium opacity-60 ml-1">{it.sub}</span> : null}
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--border-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${pct}%`, background: color, opacity: active ? 1 : 0.72 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminPage() {

  // ── Auth ─────────────────────────────────────────────────
  const [authed,   setAuthed]   = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [creds,    setCreds]    = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [showPassword, setShowPassword] = useState(false);
  const [authUser, setAuthUser] = useState<{ username: string; role: string } | null>(null);

  // ── Tab ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  // ── Analytics ────────────────────────────────────────────
  const [dashData, setDashData] = useState<DashData | null>(null);
  const [loading,  setLoading]  = useState(false);

  // ── POS (shared data — PosTab owns cart/checkout state itself) ─────
  const [posProducts,    setPosProducts]    = useState<PosProduct[]>([]);
  const [posCategories,  setPosCategories]  = useState<PosCategory_Entry[]>([]);
  const [bankOptions,    setBankOptions]    = useState<PosBank[]>([]);
  const [resellerList,   setResellerList]   = useState<PosReseller[]>([]);
  const [customerList,   setCustomerList]   = useState<PosCustomer[]>([]);
  const [posCartCount,   setPosCartCount]   = useState(0);

  // ── Analytics fetch — Firestore + main app web stats ────────
  const fetchDash = useCallback(async (authHeader?: string) => {
    setLoading(true);
    const token = authHeader ?? creds;
    const h = { 'x-admin-auth': token };
    try {
      const [oRes, pRes, rRes, cRes, bRes, custRes, webRes] = await Promise.all([
        fetch('/api/orders',       { headers: h }),
        fetch('/api/products',     { headers: h }),
        fetch('/api/resellers',    { headers: h }),
        fetch('/api/categories',   { headers: h }),
        fetch('/api/master-banks', { headers: h }),
        fetch('/api/customers',    { headers: h }),
        fetch(`${MAIN_APP}/api/admin/stats`, { headers: h }).catch(() => null),
      ]);

      // ── Firestore data ────────────────────────────────────
      const orders: { customerName: string; total: number; createdAt?: { seconds: number }; date?: string; items?: { name: string; qty: number; subtotal: number }[] }[] =
        oRes.ok ? (await oRes.json()).orders : [];
      const fetchedProducts: PosProduct[] = pRes.ok ? (await pRes.json() as { products: PosProduct[] }).products : [];
      const resellers: (PosReseller & Record<string, unknown>)[] = rRes.ok ? (await rRes.json()).resellers : [];
      const fetchedCats: { id: string; name: string; emoji: string }[] =
        cRes.ok ? (await cRes.json() as { categories: { id: string; name: string; emoji: string }[] }).categories : [];
      const fetchedBanks: PosBank[] = bRes.ok ? (await bRes.json() as { banks: PosBank[] }).banks : [];
      const fetchedCustomers: PosCustomer[] = custRes.ok ? (await custRes.json() as { customers: PosCustomer[] }).customers : [];
      setPosProducts(fetchedProducts);
      setPosCategories(fetchedCats.map(c => ({ id: c.id, label: c.name, emoji: c.emoji })));
      setResellerList(resellers.filter(r => r.status === 'approved'));
      setBankOptions(fetchedBanks);
      setCustomerList(fetchedCustomers);

      const revenue = orders.reduce((s, o) => s + (o.total ?? 0), 0);
      const recentOrders: DashOrder[] = orders.slice(0, 5).map(o => ({
        customerName: o.customerName,
        total: o.total,
        date: o.createdAt?.seconds
          ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
          : (o.date ?? '–'),
      }));
      const now = new Date();
      const revenueTrend = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (6 - i));
        const key = d.toISOString().split('T')[0];
        const label = `${d.getDate()}/${d.getMonth() + 1}`;
        const dayOrders = orders.filter(o =>
          o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000).toISOString().split('T')[0] === key : false
        );
        return { date: label, revenue: dayOrders.reduce((s, o) => s + o.total, 0), count: dayOrders.length };
      });

      // ── Web analytics (main app) ──────────────────────────
      let webStats: WebStats | null = null;
      let webStatsErr = '';
      if (webRes?.ok) {
        const ws = await webRes.json() as Record<string, unknown>;
        const devArr = (ws.devices as { type: string; count: number }[]) ?? [];
        webStats = {
          visitors:  ((ws.stats as Record<string, number>)?.visitors  ?? 0),
          pageViews: ((ws.stats as Record<string, number>)?.pageViews ?? 0),
          mobile:    devArr.find(d => d.type === 'mobile')?.count  ?? 0,
          desktop:   devArr.find(d => d.type === 'desktop')?.count ?? 0,
          daily:     (ws.daily    as WebStats['daily'])    ?? [],
          topPages:  (ws.paths    as WebStats['topPages']) ?? [],
          topMenu:       (ws.topMenu       as WebStats['topMenu'])       ?? [],
          topCategories: (ws.topCategories as WebStats['topCategories']) ?? [],
          topProducts:   (ws.topProducts   as WebStats['topProducts'])   ?? [],
        };
      } else {
        webStatsErr = !webRes
          ? 'Tidak dapat terhubung ke main app.'
          : webRes.status === 401
            ? 'Kredensial tidak cocok. Cek env ADMIN_USERNAME/PASSWORD di Vercel main app.'
            : `Gagal memuat data pengunjung (status ${webRes.status}).`;
      }

      const salesMap: Record<string, number> = {};
      orders.forEach(o => o.items?.forEach(it => { salesMap[it.name] = (salesMap[it.name] ?? 0) + it.qty; }));
      const topProducts: TopProduct[] = Object.entries(salesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => {
          const p = fetchedProducts.find(fp => fp.name === name);
          return { name, emoji: p?.emoji ?? '📦', bgColor: p?.bgColor ?? '#F5F0E9', stock: p?.stock ?? 'Ada', count };
        });

      setDashData({ orderCount: orders.length, revenue, productCount: fetchedProducts.length, resellerCount: resellers.length, recentOrders, revenueTrend, topProducts, webStats, webStatsErr });
    } catch {}
    setLoading(false);
  }, [creds]);

  // ── Session restore ──────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('admin_creds');
    if (!saved) { setChecking(false); return; }
    fetch('/api/me', { headers: { 'x-admin-auth': saved } }).then(async r => {
      if (r.ok) {
        const { user } = await r.json() as { user: { username: string; role: string } };
        setCreds(saved); setAuthUser(user); setAuthed(true); fetchDash(saved);
      } else localStorage.removeItem('admin_creds');
      setChecking(false);
    }).catch(() => setChecking(false));
  }, []);

  const login = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setLoginErr('');

    const errs: { username?: string; password?: string } = {};
    if (!username.trim()) errs.username = 'Username atau email wajib diisi.';
    if (!password)        errs.password = 'Password wajib diisi.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setFieldErrors({});

    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const { token, user } = await res.json() as { token: string; user: { username: string; role: string } };
      localStorage.setItem('admin_creds', token);
      setCreds(token); setAuthUser(user); setAuthed(true); fetchDash(token);
    } else {
      setFieldErrors({ username: ' ', password: ' ' });
      setLoginErr('Username/email atau password salah.');
    }
  };

  const logout = () => {
    localStorage.removeItem('admin_creds');
    setAuthed(false); setDashData(null); setCreds('');
  };

  // ─── Screens: Loading & Login ────────────────────────────
  if (checking) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ground)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-[3px] rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Memuat dashboard…</p>
      </div>
    </div>
  );

  if (!authed) return (
    <div className="min-h-screen flex" style={{ background: 'var(--ground)' }}>
      {/* Left panel — brand */}
      <div className="hidden lg:flex flex-col justify-between flex-1 p-12"
        style={{ background: 'var(--sidebar)' }}>
        <div className="flex items-center gap-3">
          <Image src="/icon-192.png" alt="logo" width={40} height={40} className="rounded-xl" />
          <span className="text-white font-bold text-[15px]">Cemilan Teh Risma</span>
        </div>
        <div>
          <p className="text-4xl font-extrabold text-white leading-tight mb-3">
            Kendalikan<br />bisnis snack<br />Anda.
          </p>
          <p className="text-sm" style={{ color: 'var(--sidebar-text)' }}>
            Dashboard admin untuk mengelola produk,<br />pesanan, stok, dan analitik toko.
          </p>
        </div>
        <p className="text-xs" style={{ color: 'var(--sidebar-muted)' }}>
          © 2025 Cemilan Teh Risma
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-col items-center justify-center flex-1 px-6">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8 lg:hidden">
            <Image src="/icon-192.png" alt="logo" width={56} height={56} className="rounded-2xl shadow mb-3" />
          </div>
          <h1 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Masuk</h1>
          <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Dashboard Admin Cemilan Teh Risma</p>

          <form onSubmit={login} className="space-y-4" noValidate>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Username atau Email</label>
              <input type="text" value={username}
                onChange={e => { setUsername(e.target.value); setFieldErrors(f => ({ ...f, username: undefined })); setLoginErr(''); }}
                className={`input ${fieldErrors.username ? 'input-error' : ''}`}
                placeholder="Masukkan username atau email" autoComplete="username" />
              {fieldErrors.username?.trim() && (
                <p className="text-xs font-medium mt-1.5" style={{ color: 'var(--danger)' }}>{fieldErrors.username}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password}
                  onChange={e => { setPassword(e.target.value); setFieldErrors(f => ({ ...f, password: undefined })); setLoginErr(''); }}
                  className={`input ${fieldErrors.password ? 'input-error' : ''}`}
                  style={{ paddingRight: 40 }}
                  placeholder="Masukkan password" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {fieldErrors.password?.trim() && (
                <p className="text-xs font-medium mt-1.5" style={{ color: 'var(--danger)' }}>{fieldErrors.password}</p>
              )}
            </div>
            {loginErr && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
                style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                {loginErr}
              </div>
            )}
            <button type="submit" className="btn-primary w-full justify-center py-3 text-sm">
              Masuk ke Dashboard
            </button>
          </form>

          <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
            Dikembangkan oleh PT. Eleven Digital Indonesia
          </p>
        </div>
      </div>
    </div>
  );

  // ─── Dashboard (Analytics) content ───────────────────────
  const dashboardContent = (
    <div className="p-4 lg:p-6 space-y-5">

      <TopbarPortal>
        <button onClick={() => fetchDash()} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </TopbarPortal>

      {/* Loading */}
      {loading && !dashData && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      )}

      {dashData && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: <Receipt    size={16}/>, label: 'Total Pesanan',  val: dashData.orderCount.toString(),   color: 'var(--accent)',  iconBg: 'var(--accent-bg)',  bar: '#D4691E,#A84F10' },
              { icon: <TrendingUp size={16}/>, label: 'Total Omzet',    val: formatRp(dashData.revenue),       color: 'var(--success)', iconBg: 'var(--success-bg)', bar: '#15803D,#166534' },
              { icon: <Package    size={16}/>, label: 'Produk Aktif',   val: dashData.productCount.toString(), color: '#0284C7',        iconBg: '#EFF6FF',           bar: '#0284C7,#0369A1' },
              { icon: <Users      size={16}/>, label: 'Total Reseller', val: dashData.resellerCount.toString(),color: '#7C3AED',        iconBg: '#F5F3FF',           bar: '#7C3AED,#6D28D9' },
            ].map((c, i) => (
              <div key={i} className="card relative p-4 overflow-hidden"
                style={{ transition: 'transform 0.18s, box-shadow 0.18s', cursor: 'default' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(30,16,8,0.10)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 10, background: c.iconBg, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  {c.icon}
                </div>
                <p className="tabular" style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', lineHeight: 1.15, marginBottom: 4 }}>{c.val}</p>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{c.label}</p>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: '0 0 12px 12px', background: `linear-gradient(90deg, ${c.bar})` }} />
              </div>
            ))}
          </div>

          {/* Revenue chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Omzet 7 Hari Terakhir</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tren revenue 7 hari terakhir</p>
              </div>
              {dashData.revenueTrend.some(d => d.revenue > 0) && (
                <span className="badge badge-amber">
                  Hari ini: {formatRp(dashData.revenueTrend[dashData.revenueTrend.length - 1].revenue)}
                </span>
              )}
            </div>
            {dashData.revenueTrend.every(d => d.revenue === 0) ? (
              <div className="py-8 text-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada transaksi 7 hari terakhir</p>
              </div>
            ) : (
              <RevenueChart data={dashData.revenueTrend} />
            )}
          </div>

          {/* Recent orders + Top products — 2-col */}
          <div className="grid lg:grid-cols-2 gap-4">

            {/* Recent orders */}
            {dashData.recentOrders.length > 0 ? (
              <div className="card overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <Receipt size={15} style={{ color: 'var(--accent)' }} />
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Pesanan Terbaru</p>
                </div>
                <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                  {dashData.recentOrders.map((o, i) => (
                    <div key={i} className="px-5 py-3.5 flex items-center gap-3"
                      style={{ transition: 'background 0.12s', cursor: 'default' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--success)', boxShadow: '0 0 0 3px rgba(21,128,61,0.12)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{o.date}</p>
                      </div>
                      <span className="text-sm font-extrabold tabular flex-shrink-0" style={{ color: 'var(--success)' }}>
                        {formatRp(o.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card p-10 text-center flex flex-col items-center justify-center">
                <div className="text-4xl mb-3">📊</div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada transaksi</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Buat pesanan di tab <strong>Kasir</strong> untuk mulai melihat data.
                </p>
              </div>
            )}

            {/* Top products */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                <Award size={15} style={{ color: 'var(--accent)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Produk Terlaris</p>
              </div>
              {dashData.topProducts.length > 0 ? (
                <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                  {dashData.topProducts.map((prod, i) => {
                    const rankColors = [
                      { fg: '#B8860B', bg: '#FFFBEA' },
                      { fg: '#6B7280', bg: '#F3F4F6' },
                      { fg: '#B07832', bg: '#FFF3E0' },
                    ];
                    const r = rankColors[i] ?? { fg: 'var(--text-muted)', bg: 'var(--surface-2)' };
                    const stockCls = prod.stock === 'Ada' ? 'badge-green' : prod.stock === 'Terbatas' ? 'badge-amber' : prod.stock === 'Habis' ? 'badge-red' : 'badge-gray';
                    return (
                      <div key={i} className="px-5 py-3.5 flex items-center gap-3"
                        style={{ transition: 'background 0.12s', cursor: 'default' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: r.bg, color: r.fg, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {i + 1}
                        </div>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${prod.bgColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
                          {prod.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{prod.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{prod.count} terjual</p>
                        </div>
                        <span className={`badge ${stockCls} flex-shrink-0`}>{prod.stock}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 py-10 text-center">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada data penjualan produk</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Analitik Pengunjung Web ── */}
      <div className="flex items-center gap-2.5 pt-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: '#EFF6FF', color: '#0284C7' }}>
          <Globe size={16} />
        </div>
        <div>
          <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Analitik Pengunjung Web</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Data dari main app (30 hari terakhir)</p>
        </div>
      </div>

      {/* Web stats error banner */}
      {dashData?.webStatsErr && (
        <div className="rounded-2xl px-4 py-3.5 flex items-start gap-3"
          style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-light)' }}>
          <span className="text-base flex-shrink-0">⚠️</span>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--accent-dark)' }}>Data pengunjung tidak tersedia</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--warning)' }}>{dashData.webStatsErr}</p>
          </div>
        </div>
      )}

      {/* Web stats cards */}
      {dashData?.webStats && (() => {
        const ws = dashData.webStats!;
        const devTotal = ws.mobile + ws.desktop;
        const mPct = devTotal > 0 ? Math.round((ws.mobile  / devTotal) * 100) : 0;
        const dPct = devTotal > 0 ? Math.round((ws.desktop / devTotal) * 100) : 0;
        const avgPages = ws.visitors > 0 ? (ws.pageViews / ws.visitors).toFixed(1) : '–';
        const todayViews = ws.daily.length > 0 ? ws.daily[ws.daily.length - 1].views : 0;
        return (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { icon: <Users      size={15}/>, label: 'Pengunjung Unik', val: ws.visitors.toLocaleString('id'),  color: '#0284C7', bg: '#EFF6FF' },
                { icon: <Eye        size={15}/>, label: 'Total Pageview',  val: ws.pageViews.toLocaleString('id'), color: '#7C3AED', bg: '#F5F3FF' },
                { icon: <BarChart2  size={15}/>, label: 'Hlm / Pengunjung',val: avgPages,                          color: '#059669', bg: '#ECFDF5' },
                { icon: <Eye        size={15}/>, label: 'Pageview Hari Ini',val: todayViews.toString(),             color: 'var(--accent)', bg: 'var(--accent-bg)' },
              ].map((c, i) => (
                <div key={i} className="card relative p-4 overflow-hidden">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                    style={{ background: c.bg, color: c.color }}>
                    {c.icon}
                  </div>
                  <p className="text-xl font-extrabold tabular leading-tight mb-0.5" style={{ color: 'var(--text-primary)' }}>{c.val}</p>
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-2xl"
                    style={{ background: `linear-gradient(90deg, ${c.color}, ${c.color}88)` }} />
                </div>
              ))}
            </div>

            {/* Pageview trend + device split */}
            <div className="grid lg:grid-cols-3 gap-4">
              {/* Pageview chart */}
              {ws.daily.length > 0 && (
                <div className="card p-5 lg:col-span-2">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tren Pageview 7 Hari</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Kunjungan halaman per hari</p>
                    </div>
                    <span className="badge" style={{ background: '#EFF6FF', color: '#0284C7' }}>
                      Hari ini: {todayViews}
                    </span>
                  </div>
                  <PageviewChart data={ws.daily.slice(-7)} />
                </div>
              )}

              {/* Device split */}
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-5">
                  <Smartphone size={15} style={{ color: '#0284C7' }} />
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Perangkat</p>
                </div>
                <div className="space-y-4">
                  {[
                    { icon: <Smartphone size={14}/>, label: 'Mobile',  pct: mPct, cnt: ws.mobile,  color: '#0284C7', bg: '#EFF6FF' },
                    { icon: <Monitor    size={14}/>, label: 'Desktop', pct: dPct, cnt: ws.desktop, color: '#7C3AED', bg: '#F5F3FF' },
                  ].map(d => (
                    <div key={d.label}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ background: d.bg, color: d.color }}>
                            {d.icon}
                          </div>
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{d.label}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold tabular" style={{ color: 'var(--text-primary)' }}>{d.cnt.toLocaleString('id')}</span>
                          <span className="text-xs ml-1.5" style={{ color: 'var(--text-muted)' }}>{d.pct}%</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-2)' }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${d.pct}%`, background: d.color }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs mt-5 text-center tabular" style={{ color: 'var(--text-muted)' }}>
                  Total {devTotal.toLocaleString('id')} sesi
                </p>
              </div>
            </div>

            {/* Top pages */}
            {ws.topPages.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <span>🔥</span>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Halaman Terpopuler</p>
                </div>
                <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                  {ws.topPages.slice(0, 5).map((p, i) => {
                    const top = ws.topPages[0].visitors;
                    const pct = Math.round((p.visitors / top) * 100);
                    return (
                      <div key={i} className="px-5 py-3.5 flex items-center gap-3">
                        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                          style={{ background: i === 0 ? 'var(--accent-bg)' : 'var(--surface-2)', color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                            {pageLabel(p.path)}
                          </p>
                          <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: 'var(--border-2)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#0284C7' }} />
                          </div>
                        </div>
                        <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                          {p.visitors.toLocaleString('id')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Menu & Kategori terbanyak diklik */}
            {(ws.topMenu.length > 0 || ws.topCategories.length > 0) && (
              <div className="grid lg:grid-cols-2 gap-4">
                {ws.topMenu.length > 0 && (
                  <div className="card p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: '#EFF6FF', color: '#0EA5E9' }}>
                        <MousePointerClick size={15} />
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Menu Paling Banyak Diklik</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik navigasi 30 hari terakhir</p>
                      </div>
                    </div>
                    <TopListChart
                      color="#0EA5E9"
                      items={ws.topMenu.slice(0, 6).map(m => ({ label: pageLabel(m.path), value: m.count }))}
                    />
                  </div>
                )}

                {ws.topCategories.length > 0 && (
                  <div className="card p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        <Tag size={15} />
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Kategori Terpopuler</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik filter kategori produk</p>
                      </div>
                    </div>
                    <TopListChart
                      color="var(--accent)"
                      items={ws.topCategories.map(c => ({ label: c.name, value: c.count, emoji: c.emoji }))}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Produk terbanyak diklik */}
            {ws.topProducts.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: '#FEF2F2', color: '#D4691E' }}>
                    <ShoppingCart size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Produk Paling Banyak Diklik</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik kartu produk · label menunjukkan yang ditambah ke keranjang</p>
                  </div>
                </div>
                <TopListChart
                  color="#D4691E"
                  items={ws.topProducts.slice(0, 6).map(p => ({
                    label: p.name,
                    value: p.clicks,
                    emoji: p.emoji,
                    sub: p.addToCart > 0 ? `🛒${p.addToCart}` : undefined,
                  }))}
                />
              </div>
            )}
          </>
        );
      })()}

      {/* WA Rekap */}
      <button
        onClick={() => {
          const date = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
          const ws = dashData?.webStats;
          const msg = `*Rekap Toko Cemilan Teh Risma*\n_${date}_\n\n📦 Total Pesanan: ${dashData?.orderCount ?? 0}\n💰 Total Omzet: ${formatRp(dashData?.revenue ?? 0)}\n🛍️ Produk Aktif: ${dashData?.productCount ?? 0}\n👥 Total Reseller: ${dashData?.resellerCount ?? 0}${ws ? `\n\n🌐 *Pengunjung Web*\n👤 Unik: ${ws.visitors}\n👁️ Pageview: ${ws.pageViews}\n📱 Mobile: ${ws.mobile} | 💻 Desktop: ${ws.desktop}` : ''}\n\n_Dashboard Admin Cemilan Teh Risma_`;
          window.open(`https://wa.me/6281212132014?text=${encodeURIComponent(msg)}`, '_blank');
        }}
        className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl text-sm font-bold text-white shadow-md"
        style={{ background: 'linear-gradient(135deg,#16A34A,#22C55E)' }}>
        <MessageCircle size={17} /> Kirim Rekap ke WhatsApp
      </button>

      <p className="text-center text-xs pb-4" style={{ color: 'var(--text-muted)' }}>
        Dikembangkan oleh{' '}
        <a href="https://eleven-digital.id/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
          PT. Eleven Digital Indonesia
        </a>
        {' · '}PT. RMedia Production
      </p>
    </div>
  );


  // ─── Main render ──────────────────────────────────────────
  const adminUsername = authUser?.username ?? 'Admin';
  return (
    <AppShell
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onLogout={logout}
      hasCart={posCartCount > 0}
      cartCount={posCartCount}
      username={adminUsername}
    >
      {activeTab === 'dashboard'  && dashboardContent}
      <PosTab
        creds={creds}
        posProducts={posProducts}
        posCategories={posCategories}
        resellerList={resellerList}
        customerList={customerList}
        bankOptions={bankOptions}
        isActive={activeTab === 'pos'}
        username={adminUsername}
        onCartChange={setPosCartCount}
        onGoToOrders={() => setActiveTab('orders')}
      />
      {activeTab === 'products'   && <ProductsTab   creds={creds} />}
      {activeTab === 'categories' && <CategoriesTab creds={creds} />}
      {activeTab === 'orders'     && <OrdersTab    creds={creds} />}
      {activeTab === 'resellers'  && <ResellersTab creds={creds} />}
      {activeTab === 'customers'  && <CustomersTab creds={creds} />}
      {activeTab === 'stock'      && <StockTab     creds={creds} products={posProducts} categories={posCategories} />}
      {activeTab === 'suppliers'  && <SuppliersTab  creds={creds} />}
      {activeTab === 'materials'  && <MaterialsTab  creds={creds} />}
      {activeTab === 'production' && <ProductionTab creds={creds} products={posProducts} />}
      {activeTab === 'consignment' && <ConsignmentTab creds={creds} products={posProducts} />}
      {activeTab === 'expenses'   && <ExpensesTab   creds={creds} />}
      {activeTab === 'capital'    && <CapitalTab    creds={creds} />}
      {activeTab === 'finance-report' && <FinanceReportTab creds={creds} />}
      {activeTab === 'settings'   && <SettingsTab  creds={creds} />}
    </AppShell>
  );
}
