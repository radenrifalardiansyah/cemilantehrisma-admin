'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  RefreshCw, MessageCircle, TrendingUp, Receipt, Package, Users,
  ShoppingCart, Plus, Minus, ChevronLeft,
  CheckCircle2, Loader2, User, Phone, Trash2, Tag, Send,
  Eye, Smartphone, Monitor, BarChart2, Globe,
} from 'lucide-react';
import { formatCurrency, WHATSAPP_NUMBER } from '@/lib/whatsapp';
import AppShell, { TabId } from '@/components/AppShell';
import ProductsTab  from '@/components/tabs/ProductsTab';
import OrdersTab    from '@/components/tabs/OrdersTab';
import ResellersTab from '@/components/tabs/ResellersTab';
import StockTab     from '@/components/tabs/StockTab';
import SettingsTab  from '@/components/tabs/SettingsTab';

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://cemilantehrisma.vercel.app';

// ─── Types ───────────────────────────────────────────────────────────────────
type CartEntry   = { productId: string; qty: number };
type PosView     = 'products' | 'cart' | 'done';
type PosCategory = string;

interface PosCategory_Entry { id: string; label: string; emoji: string }

const POS_CAT_ALL: PosCategory_Entry = { id: 'semua', label: 'Semua', emoji: '🛍️' };

function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : '62' + d;
}
function formatWAMessage(custName: string, invoiceNo: string, total: number, pdfUrl: string) {
  const tel = WHATSAPP_NUMBER.replace(/^62/, '0').replace(/(\d{4})(\d{4})(\d+)/, '$1-$2-$3');
  return `Halo *${custName}*! 👋\n\nInvoice pesanan Anda dari *Cemilan Teh Risma* 🧾\n\nNo. Invoice : *${invoiceNo}*\nTotal Bayar : *${formatCurrency(total)}*\n\n📄 *Invoice PDF:*\n${pdfUrl}\n\nTerima kasih! 🙏\n_Cemilan Teh Risma · 📞 ${tel}_`.trim();
}

// ─── Types & helpers ──────────────────────────────────────────────────────────
interface DashOrder { customerName: string; total: number; date: string; }
interface WebStats {
  visitors: number; pageViews: number;
  mobile: number; desktop: number;
  daily: { date: string; views: number; visitors: number }[];
  topPages: { path: string; visitors: number }[];
}
interface DashData {
  orderCount: number; revenue: number;
  productCount: number; resellerCount: number;
  recentOrders: DashOrder[];
  revenueTrend: { date: string; revenue: number; count: number }[];
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

// ─── Revenue Chart ────────────────────────────────────────────────────────────
function RevenueChart({ data }: { data: { date: string; revenue: number; count: number }[] }) {
  const maxVal = Math.max(...data.map(d => d.revenue), 1);
  const n = data.length;
  const W = 28, GAP = 10, H = 80, LH = 22;
  const totalW = n * (W + GAP) - GAP;
  const step = n > 14 ? 3 : n > 7 ? 2 : 1;
  return (
    <div className="no-scrollbar" style={{ overflowX: 'auto', paddingBottom: 2 }}>
      <svg width={totalW} height={H + LH} style={{ display: 'block', overflow: 'visible' }}>
        {data.map((d, i) => {
          const barH = Math.max((d.revenue / maxVal) * H, d.revenue > 0 ? 6 : 3);
          const x = i * (W + GAP);
          const isToday = i === n - 1;
          const showLabel = i % step === 0 || i === n - 1;
          return (
            <g key={i}>
              <rect x={x} y={H - barH} width={W} height={barH} rx="5"
                fill={isToday ? '#D97706' : '#D9770630'} />
              {d.count > 0 && (
                <text x={x + W / 2} y={H - barH - 4} textAnchor="middle" fontSize="9"
                  fill={isToday ? '#92400E' : '#9E8E72'} fontWeight="700">
                  {d.count}x
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

// ─── POS Product Card ─────────────────────────────────────────────────────────
interface PosProduct {
  id: string; name: string; price: number; emoji: string;
  imageUrls: string[]; category: string; stock: string;
  bgColor: string; weight: string; badge?: string;
}

function PosProductCard({ product, qty, onAdd, onMinus }: {
  product: PosProduct; qty: number; onAdd: () => void; onMinus: () => void;
}) {
  const imgUrl = product.imageUrls?.[0];
  return (
    <div className="card overflow-hidden flex flex-col select-none active:scale-[0.97] transition-transform cursor-pointer"
      onClick={onAdd}>
      <div className="relative w-full aspect-square overflow-hidden">
        {imgUrl ? (
          <Image src={imgUrl} alt={product.name} fill className="object-cover" sizes="(max-width: 640px) 50vw, 200px" unoptimized />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl"
            style={{ background: `${product.bgColor}22` }}>
            {product.emoji}
          </div>
        )}
        {qty > 0 && <div className="absolute inset-0 bg-black/15" />}
        {qty > 0 && (
          <div className="absolute top-2 right-2 min-w-[24px] h-6 rounded-full bg-amber-500 text-white text-[11px] font-black flex items-center justify-center px-1.5 shadow ring-2 ring-white">
            {qty}
          </div>
        )}
        {qty === 0 && (
          <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
            <Plus size={13} className="text-white" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div className="px-3 pt-2 pb-3 flex flex-col flex-1">
        <p className="text-[11px] font-bold leading-snug line-clamp-2 flex-1 mb-1.5" style={{ color: 'var(--text-primary)' }}>
          {product.name}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-black tabular" style={{ color: 'var(--accent)' }}>
            {formatCurrency(product.price)}
          </span>
          {qty > 0 ? (
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <button onClick={e => { e.stopPropagation(); onMinus(); }}
                className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                <Minus size={10} strokeWidth={2.5} />
              </button>
              <span className="text-[13px] font-black w-4 text-center tabular" style={{ color: 'var(--text-primary)' }}>{qty}</span>
              <button onClick={e => { e.stopPropagation(); onAdd(); }}
                className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center">
                <Plus size={10} strokeWidth={2.5} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
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

  // ── Tab ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  // ── Analytics ────────────────────────────────────────────
  const [dashData, setDashData] = useState<DashData | null>(null);
  const [loading,  setLoading]  = useState(false);

  // ── POS ──────────────────────────────────────────────────
  const [posProducts,    setPosProducts]    = useState<PosProduct[]>([]);
  const [posCategories,  setPosCategories]  = useState<PosCategory_Entry[]>([]);
  const [posView,      setPosView]      = useState<PosView>('products');
  const [activeCat,    setActiveCat]    = useState<PosCategory>('semua');
  const [cart,         setCart]         = useState<CartEntry[]>([]);
  const [custName,     setCustName]     = useState('');
  const [custPhone,    setCustPhone]    = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'nominal'>('percent');
  const [discountRaw,  setDiscountRaw]  = useState('');
  const [sending,      setSending]      = useState(false);
  const [sendErr,      setSendErr]      = useState('');
  const [invoiceNo,    setInvoiceNo]    = useState('');

  // ── Cart computations ────────────────────────────────────
  const getQty       = (id: string) => cart.find(i => i.productId === id)?.qty ?? 0;
  const cartItems    = cart.filter(i => i.qty > 0);
  const cartCount    = cartItems.reduce((s, i) => s + i.qty, 0);
  const cartSubtotal = cartItems.reduce((s, i) => {
    const p = posProducts.find(pr => pr.id === i.productId);
    return s + (p?.price ?? 0) * i.qty;
  }, 0);
  const discountNum    = parseFloat(discountRaw) || 0;
  const discountAmount = discountType === 'percent'
    ? Math.min(Math.round(cartSubtotal * discountNum / 100), cartSubtotal)
    : Math.min(discountNum, cartSubtotal);
  const discountLabel = discountType === 'percent' ? `${discountNum}%` : formatCurrency(discountAmount);
  const discountInfo  = discountAmount > 0 ? { amount: discountAmount, label: discountLabel } : undefined;
  const cartTotal = cartSubtotal - discountAmount;
  const hasCart   = cartItems.length > 0;
  const canSend   = hasCart && custName.trim() && custPhone.trim();

  const addToCart = (id: string) => setCart(prev => {
    const exists = prev.find(i => i.productId === id);
    if (exists) return prev.map(i => i.productId === id ? { ...i, qty: i.qty + 1 } : i);
    return [...prev, { productId: id, qty: 1 }];
  });
  const removeFromCart = (id: string) => setCart(prev =>
    prev.flatMap(i => i.productId === id
      ? i.qty > 1 ? [{ ...i, qty: i.qty - 1 }] : []
      : [i]
    )
  );
  const clearCart = () => setCart([]);
  const resetPOS = () => {
    setPosView('products'); setActiveCat('semua'); clearCart();
    setCustName(''); setCustPhone(''); setDiscountType('percent'); setDiscountRaw('');
    setSending(false); setSendErr(''); setInvoiceNo('');
  };

  // ── Analytics fetch — Firestore + main app web stats ────────
  const fetchDash = useCallback(async (authHeader?: string) => {
    setLoading(true);
    const token = authHeader ?? creds;
    const h = { 'x-admin-auth': token };
    try {
      const [oRes, pRes, rRes, cRes, webRes] = await Promise.all([
        fetch('/api/orders',     { headers: h }),
        fetch('/api/products',   { headers: h }),
        fetch('/api/resellers',  { headers: h }),
        fetch('/api/categories', { headers: h }),
        fetch(`${MAIN_APP}/api/admin/stats`, { headers: h }).catch(() => null),
      ]);

      // ── Firestore data ────────────────────────────────────
      const orders: { customerName: string; total: number; createdAt?: { seconds: number }; date?: string }[] =
        oRes.ok ? (await oRes.json()).orders : [];
      const fetchedProducts: PosProduct[] = pRes.ok ? (await pRes.json() as { products: PosProduct[] }).products : [];
      const resellers: unknown[] = rRes.ok ? (await rRes.json()).resellers : [];
      const fetchedCats: { id: string; name: string; emoji: string }[] =
        cRes.ok ? (await cRes.json() as { categories: { id: string; name: string; emoji: string }[] }).categories : [];
      setPosProducts(fetchedProducts);
      setPosCategories(fetchedCats.map(c => ({ id: c.id, label: c.name, emoji: c.emoji })));

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
        };
      } else {
        webStatsErr = !webRes
          ? 'Tidak dapat terhubung ke main app.'
          : webRes.status === 401
            ? 'Kredensial tidak cocok. Cek env ADMIN_USERNAME/PASSWORD di Vercel main app.'
            : `Gagal memuat data pengunjung (status ${webRes.status}).`;
      }

      setDashData({ orderCount: orders.length, revenue, productCount: fetchedProducts.length, resellerCount: resellers.length, recentOrders, revenueTrend, webStats, webStatsErr });
    } catch {}
    setLoading(false);
  }, [creds]);

  // ── Session restore ──────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('admin_creds');
    if (!saved) { setChecking(false); return; }
    const [u, ...rest] = saved.split(':');
    fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: rest.join(':') }),
    }).then(r => {
      if (r.ok) { setCreds(saved); setAuthed(true); fetchDash(saved); }
      else localStorage.removeItem('admin_creds');
      setChecking(false);
    }).catch(() => setChecking(false));
  }, []);

  const login = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setLoginErr('');
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const h = `${username}:${password}`;
      localStorage.setItem('admin_creds', h);
      setCreds(h); setAuthed(true); fetchDash(h);
    } else setLoginErr('Username atau password salah.');
  };

  const logout = () => {
    localStorage.removeItem('admin_creds');
    setAuthed(false); setDashData(null); setCreds('');
  };

  // ── Invoice send ─────────────────────────────────────────
  const sendInvoice = async () => {
    if (!canSend) return;
    setSending(true); setSendErr('');
    try {
      const now   = new Date();
      const pad   = (n: number) => n.toString().padStart(2, '0');
      const invNo = `INV-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const items = cartItems.map(i => {
        const p = posProducts.find(pr => pr.id === i.productId)!;
        return { name: p.name, weight: p.weight, qty: i.qty, price: p.price, subtotal: p.price * i.qty };
      });
      const res = await fetch(`${MAIN_APP}/api/admin/invoice-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({ invoiceNo: invNo, date: dateStr, customerName: custName, customerPhone: custPhone, items, subtotal: cartSubtotal, discount: discountInfo, total: cartTotal, logo: '', halalLogo: '' }),
      });
      if (!res.ok) throw new Error('Gagal generate PDF');
      const { url: pdfUrl } = await res.json() as { url: string };
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({ invoiceNo: invNo, date: dateStr, customerName: custName, customerPhone: custPhone, items, subtotal: cartSubtotal, discount: discountInfo, total: cartTotal, pdfUrl }),
      });
      window.open(`https://wa.me/${normalizePhone(custPhone)}?text=${encodeURIComponent(formatWAMessage(custName, invNo, cartTotal, pdfUrl))}`, '_blank');
      setInvoiceNo(invNo); setPosView('done');
    } catch { setSendErr('Gagal mengirim invoice. Coba lagi.'); }
    finally { setSending(false); }
  };

  // ─── POS filtered products ───────────────────────────────
  const filteredProducts = activeCat === 'semua' ? posProducts : posProducts.filter(p => p.category === activeCat);

  // ─── Screens: Loading & Login ────────────────────────────
  if (checking) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ground)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-[3px] border-amber-400 border-t-transparent rounded-full animate-spin" />
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

          <form onSubmit={login} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                className="input" placeholder="Masukkan username" autoComplete="username" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="input" placeholder="Masukkan password" autoComplete="current-password" />
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

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Ringkasan Toko</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Data real-time dari database</p>
        </div>
        <button onClick={() => fetchDash()} disabled={loading} className="btn-ghost p-2.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

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
              { icon: <Receipt  size={16}/>, label: 'Total Pesanan',  val: dashData.orderCount.toString(),   color: 'var(--accent)' },
              { icon: <TrendingUp size={16}/>, label: 'Total Omzet', val: formatRp(dashData.revenue),        color: 'var(--success)' },
              { icon: <Package  size={16}/>, label: 'Produk Aktif',  val: dashData.productCount.toString(),  color: '#0284C7' },
              { icon: <Users    size={16}/>, label: 'Total Reseller', val: dashData.resellerCount.toString(), color: '#D97706' },
            ].map((c, i) => (
              <div key={i} className="card relative p-4 overflow-hidden">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                  style={{ background: 'var(--accent-bg)', color: c.color }}>
                  {c.icon}
                </div>
                <p className="text-xl font-extrabold tabular leading-tight mb-0.5" style={{ color: 'var(--text-primary)' }}>{c.val}</p>
                <p className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                <div className="stat-card-accent" />
              </div>
            ))}
          </div>

          {/* Revenue chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Omzet 7 Hari Terakhir</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Angka di atas bar = jumlah transaksi</p>
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

          {/* Recent orders */}
          {dashData.recentOrders.length > 0 ? (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                <Receipt size={15} style={{ color: 'var(--accent)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Pesanan Terbaru</p>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border-2)' }}>
                {dashData.recentOrders.map((o, i) => (
                  <div key={i} className="px-5 py-3.5 flex items-center gap-3">
                    <span className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0"
                      style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{o.date}</p>
                    </div>
                    <span className="text-sm font-extrabold tabular flex-shrink-0" style={{ color: 'var(--accent)' }}>
                      {formatRp(o.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card p-12 text-center">
              <div className="text-5xl mb-4">📊</div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada transaksi</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Buat pesanan di tab <strong>Kasir</strong> untuk mulai melihat data di sini.
              </p>
            </div>
          )}
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
          style={{ background: '#FFF7ED', border: '1px solid #FDE68A' }}>
          <span className="text-base flex-shrink-0">⚠️</span>
          <div>
            <p className="text-xs font-semibold" style={{ color: '#92400E' }}>Data pengunjung tidak tersedia</p>
            <p className="text-xs mt-0.5" style={{ color: '#B45309' }}>{dashData.webStatsErr}</p>
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
                { icon: <Eye        size={15}/>, label: 'Pageview Hari Ini',val: todayViews.toString(),             color: '#D97706', bg: '#FFFBEB' },
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
                <div className="divide-y" style={{ borderColor: 'var(--border-2)' }}>
                  {ws.topPages.slice(0, 5).map((p, i) => {
                    const top = ws.topPages[0].visitors;
                    const pct = Math.round((p.visitors / top) * 100);
                    return (
                      <div key={i} className="px-5 py-3.5 flex items-center gap-3">
                        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                          style={{ background: i === 0 ? '#FFFBEB' : 'var(--surface-2)', color: i === 0 ? '#D97706' : 'var(--text-muted)' }}>
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

  // ─── POS content ─────────────────────────────────────────
  const posProductsContent = (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-4 pt-4 pb-3 overflow-x-auto no-scrollbar flex-shrink-0">
        {[POS_CAT_ALL, ...posCategories].map(c => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            className={`tab-chip ${activeCat === c.id ? 'active' : ''}`}>
            <span>{c.emoji}</span> {c.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-24 thin-scrollbar">
        {posProducts.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredProducts.map(p => (
              <PosProductCard key={p.id} product={p} qty={getQty(p.id)}
                onAdd={() => addToCart(p.id)} onMinus={() => removeFromCart(p.id)} />
            ))}
          </div>
        )}
      </div>
      {hasCart && (
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-5 pt-2"
          style={{ background: 'linear-gradient(to top, var(--ground) 70%, transparent)' }}>
          <button onClick={() => setPosView('cart')}
            className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-white font-bold shadow-2xl"
            style={{ background: 'linear-gradient(135deg,#D97706,#EA580C)' }}>
            <div className="relative">
              <ShoppingCart size={19} />
              <span className="absolute -top-2 -right-2.5 w-5 h-5 rounded-full bg-white text-amber-600 text-[10px] font-black flex items-center justify-center shadow">
                {cartCount}
              </span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-[11px] text-white/70">{cartItems.length} produk · {cartCount} pcs</p>
              <p className="text-[15px] font-black tabular">{formatCurrency(cartTotal)}</p>
            </div>
            <span className="text-sm opacity-90">Checkout →</span>
          </button>
        </div>
      )}
    </div>
  );

  const posCartContent = (
    <div className="overflow-y-auto px-4 pt-4 pb-8 space-y-3 thin-scrollbar" style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* Order list */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-2)' }}>
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Pesanan <span style={{ color: 'var(--accent)' }}>({cartCount} pcs)</span>
          </span>
          <button onClick={clearCart} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--danger)' }}>
            <Trash2 size={12} /> Kosongkan
          </button>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border-2)' }}>
          {cartItems.map(item => {
            const p = posProducts.find(pr => pr.id === item.productId);
            if (!p) return null;
            const imgUrl = p.imageUrls?.[0];
            return (
              <div key={item.productId} className="flex items-center gap-3 px-4 py-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 relative" style={{ background: `${p.bgColor}22` }}>
                  {imgUrl ? <Image src={imgUrl} alt={p.name} fill className="object-cover" sizes="40px" unoptimized />
                          : <div className="w-full h-full flex items-center justify-center text-lg">{p.emoji}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                  <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>{formatCurrency(p.price)} / pcs</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => removeFromCart(item.productId)}
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    <Minus size={11} strokeWidth={2.5} />
                  </button>
                  <span className="w-5 text-center text-sm font-black tabular" style={{ color: 'var(--text-primary)' }}>{item.qty}</span>
                  <button onClick={() => addToCart(item.productId)}
                    className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center">
                    <Plus size={11} strokeWidth={2.5} />
                  </button>
                </div>
                <span className="text-sm font-bold tabular w-16 text-right flex-shrink-0" style={{ color: 'var(--accent-dark)' }}>
                  {formatCurrency(p.price * item.qty)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border-2)', borderTop: '1px solid var(--border-2)' }}>
          {discountAmount > 0 && (
            <>
              <div className="px-4 py-2.5 flex justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Subtotal</span>
                <span className="text-sm font-semibold tabular" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(cartSubtotal)}</span>
              </div>
              <div className="px-4 py-2.5 flex justify-between" style={{ background: 'var(--success-bg)' }}>
                <span className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--success)' }}>
                  <Tag size={11} /> Diskon ({discountLabel})
                </span>
                <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>− {formatCurrency(discountAmount)}</span>
              </div>
            </>
          )}
          <div className="px-4 py-3.5 flex justify-between" style={{ background: 'var(--accent-bg)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Bayar</span>
            <span className="text-xl font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatCurrency(cartTotal)}</span>
          </div>
        </div>
      </div>

      {/* Discount */}
      <div className="card p-4">
        <p className="section-label mb-3 flex items-center gap-1.5"><Tag size={11} /> Diskon (opsional)</p>
        <div className="flex gap-2">
          <div className="flex rounded-xl overflow-hidden border text-xs font-bold flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
            {(['percent', 'nominal'] as const).map(t => (
              <button key={t} onClick={() => { setDiscountType(t); setDiscountRaw(''); }}
                className="px-3.5 py-2.5 transition-all"
                style={discountType === t ? { background: 'linear-gradient(135deg,#D97706,#EA580C)', color: 'white' } : { color: 'var(--text-muted)' }}>
                {t === 'percent' ? '%' : 'Rp'}
              </button>
            ))}
          </div>
          <input type="number" min="0" value={discountRaw} onChange={e => setDiscountRaw(e.target.value)}
            className="input flex-1" placeholder={discountType === 'percent' ? 'Contoh: 10' : 'Contoh: 5000'} />
          {discountRaw && (
            <button onClick={() => setDiscountRaw('')} className="btn-ghost px-3 text-xs" style={{ color: 'var(--danger)' }}>✕</button>
          )}
        </div>
        {discountAmount > 0 && (
          <p className="text-xs mt-2 font-medium" style={{ color: 'var(--success)' }}>
            Hemat {formatCurrency(discountAmount)} → bayar {formatCurrency(cartTotal)}
          </p>
        )}
      </div>

      {/* Customer */}
      <div className="card p-4 space-y-3">
        <p className="section-label">Data Customer</p>
        <div className="relative">
          <User size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input type="text" value={custName} onChange={e => setCustName(e.target.value)}
            className="input" style={{ paddingLeft: 38 }} placeholder="Nama customer" />
        </div>
        <div className="relative">
          <Phone size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input type="tel" value={custPhone} onChange={e => setCustPhone(e.target.value)}
            className="input" style={{ paddingLeft: 38 }} placeholder="Nomor WhatsApp (08xxx)" />
        </div>
      </div>

      {sendErr && (
        <div className="px-4 py-3 rounded-xl text-xs font-medium" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          {sendErr}
        </div>
      )}

      <button onClick={sendInvoice} disabled={!canSend || sending}
        className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl text-white font-bold text-sm shadow-xl disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg,#16A34A,#22C55E)' }}>
        {sending ? <><Loader2 size={17} className="animate-spin" /> Membuat PDF…</> : <><Send size={17} /> Kirim Invoice PDF ke WA</>}
      </button>
    </div>
  );

  const posDoneContent = (
    <div className="flex flex-col items-center justify-center py-20 px-6 gap-5">
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'var(--success-bg)' }}>
        <CheckCircle2 size={44} style={{ color: 'var(--success)' }} />
      </div>
      <div className="text-center">
        <p className="text-xl font-extrabold mb-2" style={{ color: 'var(--text-primary)' }}>Invoice Terkirim!</p>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          PDF invoice untuk <strong>{custName}</strong> sudah siap di WhatsApp.
        </p>
        {invoiceNo && <p className="text-xs mt-1.5 badge badge-amber mx-auto inline-block">{invoiceNo}</p>}
      </div>
      <button onClick={resetPOS} className="btn-primary px-8 py-3.5 text-sm mt-2">
        Transaksi Baru
      </button>
    </div>
  );

  const posContent = (
    <div className="relative flex flex-col" style={{ height: '100%' }}>
      {posView !== 'done' && (
        <div className="px-4 pt-4 pb-3 flex items-center gap-3 flex-shrink-0">
          {posView === 'cart' && (
            <button onClick={() => { setPosView('products'); setSendErr(''); }}
              className="btn-ghost p-2.5">
              <ChevronLeft size={16} />
            </button>
          )}
          <div className="flex-1">
            <p className="text-[15px] font-extrabold" style={{ color: 'var(--text-primary)' }}>
              {posView === 'products' ? 'Pilih Produk' : 'Detail & Checkout'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {posView === 'products'
                ? `${filteredProducts.length} produk tersedia`
                : `${cartItems.length} jenis · ${cartCount} pcs`}
            </p>
          </div>
          {posView === 'products' && hasCart && (
            <button onClick={() => setPosView('cart')} className="btn-ghost gap-2 text-xs py-2">
              <ShoppingCart size={14} />
              <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">
                {cartCount}
              </span>
            </button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-hidden relative">
        {posView === 'products' && posProductsContent}
        {posView === 'cart'     && posCartContent}
        {posView === 'done'     && posDoneContent}
      </div>
    </div>
  );

  // ─── Main render ──────────────────────────────────────────
  return (
    <AppShell
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onLogout={logout}
      hasCart={hasCart}
      cartCount={cartCount}
    >
      {activeTab === 'dashboard'  && dashboardContent}
      {activeTab === 'pos'        && posContent}
      {activeTab === 'products'   && <ProductsTab  creds={creds} />}
      {activeTab === 'orders'     && <OrdersTab    creds={creds} />}
      {activeTab === 'resellers'  && <ResellersTab creds={creds} />}
      {activeTab === 'stock'      && <StockTab     creds={creds} />}
      {activeTab === 'settings'   && <SettingsTab  creds={creds} />}
    </AppShell>
  );
}
