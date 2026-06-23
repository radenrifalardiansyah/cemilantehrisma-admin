'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  LogOut, RefreshCw, MessageCircle, Eye, Smartphone,
  TrendingUp, BarChart2, Home, ShoppingCart, Plus, Minus,
  ChevronLeft, CheckCircle2, Loader2, User, Phone, Trash2, Tag,
  Send, Package, Receipt, Users, Warehouse, Settings,
} from 'lucide-react';
import { products as hardcodedProducts } from '@/lib/products';
import { formatCurrency, WHATSAPP_NUMBER } from '@/lib/whatsapp';
import ProductsTab from '@/components/tabs/ProductsTab';
import OrdersTab from '@/components/tabs/OrdersTab';
import ResellersTab from '@/components/tabs/ResellersTab';
import StockTab from '@/components/tabs/StockTab';
import SettingsTab from '@/components/tabs/SettingsTab';

const MAIN_APP = process.env.NEXT_PUBLIC_API_URL ?? 'https://cemilantehrisma.vercel.app';

// ─── Analytics helpers ───────────────────────────────────────────────────────

const PAGE_LABELS: Record<string, string> = {
  '/': 'Beranda', '/products': 'Menu Produk', '/reseller': 'Reseller',
  '/panduan': 'Panduan', '/kontak': 'Kontak', '/checkout': 'Checkout',
};
function pageLabel(p: string) { return PAGE_LABELS[p] ?? p; }
type DailyRow = { date: string; views: number; visitors: number };

function MiniBarChart({ data }: { data: DailyRow[] }) {
  const maxVal = Math.max(...data.map(d => d.views), 1);
  const W = 36, GAP = 4, H = 64, LABEL_H = 14, totalW = data.length * (W + GAP);
  return (
    <svg width="100%" viewBox={`0 0 ${totalW} ${H + LABEL_H}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const barH = Math.max((d.views / maxVal) * H, d.views > 0 ? 4 : 2);
        const x = i * (W + GAP);
        return (
          <g key={i}>
            <rect x={x} y={H - barH} width={W} height={barH} rx="4" fill={i === data.length - 1 ? '#D97706' : '#FDE68A'} />
            {d.views > 0 && <text x={x + W / 2} y={H - barH - 3} textAnchor="middle" fontSize="8" fill="#92400E" fontWeight="600">{d.views}</text>}
            <text x={x + W / 2} y={H + LABEL_H - 2} textAnchor="middle" fontSize="8" fill="#B45309">{d.date.slice(5)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ mobile, desktop }: { mobile: number; desktop: number }) {
  const total = mobile + desktop;
  if (total === 0) return (
    <svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="28" fill="none" stroke="#FDE68A" strokeWidth="12" />
      <text x="40" y="44" textAnchor="middle" fontSize="10" fill="#B45309">–</text>
    </svg>
  );
  const r = 28, cx = 40, cy = 40, circ = 2 * Math.PI * r;
  const mArc = (mobile / total) * circ, mPct = Math.round((mobile / total) * 100);
  return (
    <svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#FDE68A" strokeWidth="12" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#D97706" strokeWidth="12"
        strokeDasharray={`${mArc} ${circ - mArc}`} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="11" fontWeight="700" fill="#92400E">{mPct}%</text>
      <text x={cx} y={cy + 9} textAnchor="middle" fontSize="7" fill="#B45309">mobile</text>
    </svg>
  );
}

// ─── POS helpers ─────────────────────────────────────────────────────────────

type CartEntry = { productId: string; qty: number };
type PosView   = 'products' | 'cart' | 'done';
type Category  = 'semua' | 'mie' | 'keripik' | 'paket';

const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: 'semua',   label: 'Semua',   emoji: '🛍️' },
  { id: 'mie',     label: 'Mie',     emoji: '🍝' },
  { id: 'keripik', label: 'Keripik', emoji: '🥔' },
  { id: 'paket',   label: 'Paket',   emoji: '🎁' },
];

function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : '62' + d;
}

function formatWAMessage(custName: string, invoiceNo: string, total: number, pdfUrl: string) {
  const tel = WHATSAPP_NUMBER.replace(/^62/, '0').replace(/(\d{4})(\d{4})(\d+)/, '$1-$2-$3');
  return `Halo *${custName}*! 👋\n\nBerikut invoice pesanan Anda dari *Cemilan Teh Risma* 🧾\n\nNo. Invoice : *${invoiceNo}*\nTotal Bayar : *${formatCurrency(total)}*\n\n📄 *Lihat Invoice PDF:*\n${pdfUrl}\n\nTerima kasih sudah pesan! 🙏\n_Cemilan Teh Risma · 📞 ${tel}_`.trim();
}

type Product = (typeof hardcodedProducts)[0];

function ProductCard({ product, qty, onAdd, onMinus }: {
  product: Product; qty: number; onAdd: () => void; onMinus: () => void;
}) {
  const img = product.images?.[0];
  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-md flex flex-col select-none border border-gray-100 active:scale-[0.97] transition-transform">
      <div className="relative w-full aspect-square overflow-hidden cursor-pointer" onClick={onAdd}>
        {img ? (
          <Image src={img} alt={product.name} fill className="object-cover" sizes="(max-width: 640px) 50vw, 200px" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl"
            style={{ background: `linear-gradient(135deg,${product.bgColor}cc,${product.bgColor}88)` }}>
            {product.emoji}
          </div>
        )}
        {qty > 0 && <div className="absolute inset-0 bg-black/20" />}
        {qty > 0 && (
          <div className="absolute top-2 right-2 min-w-[26px] h-[26px] rounded-full bg-amber-500 text-white text-xs font-black flex items-center justify-center px-1.5 shadow-lg ring-2 ring-white">
            {qty}
          </div>
        )}
        {qty === 0 && (
          <div className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <Plus size={15} className="text-white" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3 flex flex-col flex-1">
        <p className="text-[11px] font-bold text-gray-800 leading-snug line-clamp-2 flex-1 mb-1">{product.name}</p>
        <p className="text-[10px] text-gray-400 mb-2">{product.weight}</p>
        <div className="flex items-center justify-between">
          <span className="text-sm font-black text-amber-600">{formatCurrency(product.price)}</span>
          {qty > 0 ? (
            <div className="flex items-center gap-1.5">
              <button onClick={e => { e.stopPropagation(); onMinus(); }}
                className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center active:bg-gray-200">
                <Minus size={11} strokeWidth={2.5} />
              </button>
              <span className="text-sm font-black text-gray-800 w-4 text-center">{qty}</span>
              <button onClick={e => { e.stopPropagation(); onAdd(); }}
                className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center active:bg-amber-600">
                <Plus size={11} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <button onClick={onAdd}
              className="w-7 h-7 rounded-full text-white flex items-center justify-center shadow-md active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg,#D97706,#EA580C)' }}>
              <Plus size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab type ─────────────────────────────────────────────────────────────────

type TabId = 'dashboard' | 'pos' | 'products' | 'orders' | 'resellers' | 'stock' | 'settings';

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminPage() {
  // Auth
  const [authed,   setAuthed]   = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [creds,    setCreds]    = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [stats,    setStats]    = useState<Record<string, unknown> | null>(null);
  const [statsErr, setStatsErr] = useState('');

  // Tabs
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  // POS state
  const [posView,       setPosView]       = useState<PosView>('products');
  const [activeCat,     setActiveCat]     = useState<Category>('semua');
  const [cart,          setCart]          = useState<CartEntry[]>(() => hardcodedProducts.map(p => ({ productId: p.id, qty: 0 })));
  const [custName,      setCustName]      = useState('');
  const [custPhone,     setCustPhone]     = useState('');
  const [discountType,  setDiscountType]  = useState<'percent' | 'nominal'>('percent');
  const [discountRaw,   setDiscountRaw]   = useState('');
  const [sending,       setSending]       = useState(false);
  const [sendErr,       setSendErr]       = useState('');
  const [invoiceNo,     setInvoiceNo]     = useState('');

  // Cart computations
  const cartItems    = cart.filter(i => i.qty > 0);
  const cartCount    = cartItems.reduce((s, i) => s + i.qty, 0);
  const cartSubtotal = cartItems.reduce((s, i) => {
    const p = hardcodedProducts.find(pr => pr.id === i.productId);
    return s + (p?.price ?? 0) * i.qty;
  }, 0);
  const discountNum    = parseFloat(discountRaw) || 0;
  const discountAmount = discountType === 'percent'
    ? Math.min(Math.round(cartSubtotal * discountNum / 100), cartSubtotal)
    : Math.min(discountNum, cartSubtotal);
  const discountLabel = discountType === 'percent' ? `${discountNum}%` : formatCurrency(discountAmount);
  const discountInfo  = discountAmount > 0 ? { amount: discountAmount, label: discountLabel } : undefined;
  const cartTotal     = cartSubtotal - discountAmount;
  const hasCart       = cartItems.length > 0;
  const canSend       = hasCart && custName.trim() && custPhone.trim();

  const addToCart      = (id: string) => setCart(p => p.map(i => i.productId === id ? { ...i, qty: i.qty + 1 } : i));
  const removeFromCart = (id: string) => setCart(p => p.map(i => i.productId === id ? { ...i, qty: Math.max(0, i.qty - 1) } : i));
  const clearCart      = () => setCart(hardcodedProducts.map(p => ({ productId: p.id, qty: 0 })));

  const resetPOS = () => {
    setPosView('products'); setActiveCat('semua'); clearCart();
    setCustName(''); setCustPhone('');
    setDiscountType('percent'); setDiscountRaw('');
    setSending(false); setSendErr(''); setInvoiceNo('');
  };

  // Save order to Firebase and send invoice
  const sendInvoice = async () => {
    if (!canSend) return;
    setSending(true); setSendErr('');
    try {
      const now     = new Date();
      const pad     = (n: number) => n.toString().padStart(2, '0');
      const invNo   = `INV-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

      const items = cartItems.map(i => {
        const p = hardcodedProducts.find(pr => pr.id === i.productId)!;
        return { name: p.name, weight: p.weight, qty: i.qty, price: p.price, subtotal: p.price * i.qty };
      });

      // Generate PDF via main app
      const res = await fetch(`${MAIN_APP}/api/admin/invoice-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({
          invoiceNo: invNo, date: dateStr,
          customerName: custName, customerPhone: custPhone,
          items, subtotal: cartSubtotal, discount: discountInfo, total: cartTotal,
          logo: '', halalLogo: '',
        }),
      });
      if (!res.ok) throw new Error('Gagal generate PDF');
      const { url: pdfUrl } = await res.json() as { url: string };

      // Save order to Firebase
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({
          invoiceNo: invNo, date: dateStr,
          customerName: custName, customerPhone: custPhone,
          items, subtotal: cartSubtotal, discount: discountInfo, total: cartTotal,
          pdfUrl,
        }),
      });

      const phone  = normalizePhone(custPhone);
      const waText = formatWAMessage(custName, invNo, cartTotal, pdfUrl);
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(waText)}`, '_blank');

      setInvoiceNo(invNo);
      setPosView('done');
    } catch {
      setSendErr('Gagal mengirim invoice. Coba lagi.');
    } finally {
      setSending(false);
    }
  };

  // Analytics
  const fetchStats = useCallback(async (authHeader?: string) => {
    setLoading(true); setStatsErr('');
    try {
      const token = authHeader ?? creds;
      const res = await fetch(`${MAIN_APP}/api/admin/stats`, { headers: token ? { 'x-admin-auth': token } : {} });
      if (res.ok) setStats(await res.json());
      else if (res.status === 500) setStatsErr('Gagal memuat data.');
      else setStatsErr('Sesi habis. Silakan login ulang.');
    } catch { setStatsErr('Gagal memuat data.'); }
    setLoading(false);
  }, [creds]);

  useEffect(() => {
    const saved = localStorage.getItem('admin_creds');
    if (!saved) { setChecking(false); return; }
    // Validate against local login endpoint
    const [u, ...rest] = saved.split(':');
    const p = rest.join(':');
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    }).then(r => {
      if (r.ok) { setCreds(saved); setAuthed(true); fetchStats(saved); }
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
      setCreds(h); setAuthed(true); fetchStats(h);
    } else setLoginErr('Username atau password salah.');
  };

  const logout = () => {
    localStorage.removeItem('admin_creds');
    setAuthed(false); setStats(null); setCreds('');
  };

  const sendWA = () => {
    const s = stats as Record<string, Record<string, unknown> | unknown[] | null> | null;
    const total     = (s?.stats as Record<string,unknown>)?.visitors ?? '–';
    const pageViews = (s?.stats as Record<string,unknown>)?.pageViews ?? '–';
    const devArr    = (s?.devices as unknown[]) ?? [];
    const mob       = (devArr.find((d:unknown) => (d as Record<string,string>).type==='mobile')  as Record<string,number>|undefined)?.count ?? 0;
    const desk      = (devArr.find((d:unknown) => (d as Record<string,string>).type==='desktop') as Record<string,number>|undefined)?.count ?? 0;
    const topPages  = ((s?.paths as unknown[]) ?? []).slice(0,3).map((p:unknown,i:number) => {
      const pg = p as Record<string,unknown>;
      return `${i+1}. ${pageLabel(pg.path as string)} — ${pg.visitors}x`;
    }).join('\n');
    const date = new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const msg = `*Rekap Cemilan Teh Risma*\n_${date}_\n\n*Pengunjung:* ${total}\n*Halaman Dibuka:* ${pageViews}\n*Mobile:* ${mob}  |  *Desktop:* ${desk}\n`+(topPages?`\n*Terpopuler:*\n${topPages}\n`:'')+`\n_Dashboard Cemilan Teh Risma_`;
    window.open(`https://wa.me/6281212132014?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (checking) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#FFFBF5' }}>
      <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── Login ─────────────────────────────────────────────────────────────────
  if (!authed) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#FFFBF5' }}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-amber-100 p-8">
        <div className="flex flex-col items-center mb-6">
          <Image src="/icon-192.png" alt="Cemilan Teh Risma" width={64} height={64} className="rounded-2xl shadow mb-3" />
          <p className="font-bold text-amber-900 text-sm">Dashboard Admin</p>
          <p className="text-amber-600/60 text-xs">Cemilan Teh Risma</p>
        </div>
        <form onSubmit={login} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-amber-700 mb-1.5">Username</label>
            <input type="text" value={username} onChange={e=>setUsername(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-amber-200 text-sm text-amber-900 focus:outline-none focus:border-amber-400 bg-amber-50/50"
              placeholder="Username" autoComplete="username" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-amber-700 mb-1.5">Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-amber-200 text-sm text-amber-900 focus:outline-none focus:border-amber-400 bg-amber-50/50"
              placeholder="Password" autoComplete="current-password" />
          </div>
          {loginErr && <p className="text-red-500 text-xs">{loginErr}</p>}
          <button type="submit"
            className="w-full py-3 rounded-xl text-sm font-bold text-white shadow transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#D97706,#EA580C)' }}>
            Masuk
          </button>
        </form>
      </div>
    </div>
  );

  // ── Analytics data ────────────────────────────────────────────────────────
  const s        = stats as Record<string,Record<string,unknown>|unknown[]|null>|null;
  const total    = (s?.stats as Record<string,unknown>)?.visitors  as number|undefined;
  const views    = (s?.stats as Record<string,unknown>)?.pageViews as number|undefined;
  const devArr   = (s?.devices as unknown[]) ?? [];
  const mobile   = (devArr.find((d:unknown)=>(d as Record<string,string>).type==='mobile')  as Record<string,number>|undefined)?.count ?? 0;
  const desktop  = (devArr.find((d:unknown)=>(d as Record<string,string>).type==='desktop') as Record<string,number>|undefined)?.count ?? 0;
  const topPages = (s?.paths  as unknown[]) ?? [];
  const daily    = ((s?.daily  as unknown[]) ?? []) as DailyRow[];
  const devTotal = mobile + desktop;
  const mPct     = devTotal > 0 ? Math.round((mobile /devTotal)*100) : 0;
  const dPct     = devTotal > 0 ? Math.round((desktop/devTotal)*100) : 0;
  const todayViews = daily.length > 0 ? daily[daily.length-1].views : 0;

  // ── POS: product grid ─────────────────────────────────────────────────────
  const filteredProducts = activeCat === 'semua' ? hardcodedProducts : hardcodedProducts.filter(p => p.category === activeCat);

  const renderProducts = () => (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-4 pt-4 pb-3 overflow-x-auto no-scrollbar flex-shrink-0">
        {CATEGORIES.map(c => {
          const isActive = activeCat === c.id;
          return (
            <button key={c.id} onClick={() => setActiveCat(c.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-all border ${isActive ? 'text-white border-transparent shadow-md' : 'text-gray-500 bg-white border-gray-200 hover:border-amber-300 hover:text-amber-600'}`}
              style={isActive ? { background: 'linear-gradient(135deg,#D97706,#EA580C)' } : {}}>
              <span>{c.emoji}</span>{c.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {filteredProducts.map(p => {
            const entry = cart.find(i => i.productId === p.id)!;
            return (
              <ProductCard key={p.id} product={p} qty={entry.qty}
                onAdd={() => addToCart(p.id)} onMinus={() => removeFromCart(p.id)} />
            );
          })}
        </div>
      </div>
      {hasCart && (
        <div className="px-4 pb-5 pt-2 flex-shrink-0" style={{ background: 'linear-gradient(to top, #FFFBF5 80%, transparent)' }}>
          <button onClick={() => setPosView('cart')}
            className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-white font-bold shadow-2xl active:scale-[0.98] transition-transform"
            style={{ background: 'linear-gradient(135deg,#D97706,#EA580C)' }}>
            <div className="relative">
              <ShoppingCart size={20} />
              <span className="absolute -top-2 -right-2.5 w-5 h-5 rounded-full bg-white text-amber-600 text-[10px] font-black flex items-center justify-center shadow">{cartCount}</span>
            </div>
            <div className="flex-1 text-left leading-tight">
              <p className="text-[11px] text-white/70">{cartItems.length} produk · {cartCount} pcs</p>
              <p className="text-base font-black">{formatCurrency(cartTotal)}</p>
            </div>
            <span className="text-sm opacity-90">Checkout →</span>
          </button>
        </div>
      )}
    </div>
  );

  const renderCart = () => (
    <div className="overflow-y-auto px-4 pt-4 pb-8 space-y-3 h-full">
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-800">Pesanan <span className="text-amber-500">({cartCount} pcs)</span></span>
          <button onClick={clearCart} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-500 transition-colors">
            <Trash2 size={12} /> Kosongkan
          </button>
        </div>
        <div className="divide-y divide-gray-50">
          {cartItems.map(item => {
            const p   = hardcodedProducts.find(pr => pr.id === item.productId)!;
            const img = p.images?.[0];
            return (
              <div key={item.productId} className="flex items-center gap-3 px-3 py-3">
                <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 relative">
                  {img
                    ? <Image src={img} alt={p.name} fill className="object-cover" sizes="44px" />
                    : <div className="w-full h-full flex items-center justify-center text-lg" style={{ background: `${p.bgColor}33` }}>{p.emoji}</div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate leading-tight">{p.name}</p>
                  <p className="text-xs text-gray-400">{formatCurrency(p.price)} / pcs</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => removeFromCart(item.productId)} className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center active:bg-gray-200"><Minus size={12} strokeWidth={2.5} /></button>
                  <span className="w-5 text-center text-sm font-black text-gray-800">{item.qty}</span>
                  <button onClick={() => addToCart(item.productId)} className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center active:bg-amber-600"><Plus size={12} strokeWidth={2.5} /></button>
                </div>
                <span className="text-sm font-bold text-amber-700 w-16 text-right flex-shrink-0">{formatCurrency(p.price * item.qty)}</span>
              </div>
            );
          })}
        </div>
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {discountAmount > 0 && (
            <div className="px-4 py-2.5 flex justify-between items-center">
              <span className="text-xs text-gray-400">Subtotal</span>
              <span className="text-sm font-semibold text-gray-600">{formatCurrency(cartSubtotal)}</span>
            </div>
          )}
          {discountAmount > 0 && (
            <div className="px-4 py-2.5 flex justify-between items-center bg-green-50/60">
              <span className="text-xs text-green-600 font-semibold flex items-center gap-1"><Tag size={11} /> Diskon ({discountLabel})</span>
              <span className="text-sm font-bold text-green-600">− {formatCurrency(discountAmount)}</span>
            </div>
          )}
          <div className="px-4 py-3.5 flex justify-between items-center bg-amber-50/50">
            <span className="text-sm font-bold text-gray-700">Total Bayar</span>
            <span className="text-xl font-black text-amber-600">{formatCurrency(cartTotal)}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Tag size={11} /> Diskon <span className="font-normal normal-case">(opsional)</span></p>
        <div className="flex gap-2">
          <div className="flex rounded-xl overflow-hidden border border-gray-200 flex-shrink-0 text-xs font-bold">
            <button onClick={() => { setDiscountType('percent'); setDiscountRaw(''); }}
              className={`px-3.5 py-2.5 transition-all ${discountType === 'percent' ? 'text-white' : 'text-gray-500 bg-white hover:bg-gray-50'}`}
              style={discountType === 'percent' ? { background: 'linear-gradient(135deg,#D97706,#EA580C)' } : {}}>%</button>
            <button onClick={() => { setDiscountType('nominal'); setDiscountRaw(''); }}
              className={`px-3 py-2.5 transition-all ${discountType === 'nominal' ? 'text-white' : 'text-gray-500 bg-white hover:bg-gray-50'}`}
              style={discountType === 'nominal' ? { background: 'linear-gradient(135deg,#D97706,#EA580C)' } : {}}>Rp</button>
          </div>
          <div className="relative flex-1">
            <input type="number" min="0" max={discountType === 'percent' ? 100 : cartSubtotal}
              value={discountRaw} onChange={e => setDiscountRaw(e.target.value)}
              placeholder={discountType === 'percent' ? 'Contoh: 10' : 'Contoh: 5000'}
              className="w-full px-3 pr-9 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">{discountType === 'percent' ? '%' : 'Rp'}</span>
          </div>
          {discountRaw && <button onClick={() => setDiscountRaw('')} className="px-3 rounded-xl bg-red-50 text-red-400 hover:bg-red-100 transition-colors border border-red-100 text-xs font-bold">✕</button>}
        </div>
        {discountAmount > 0 && <p className="text-xs text-green-600 mt-2 font-medium">Hemat {formatCurrency(discountAmount)} → bayar {formatCurrency(cartTotal)}</p>}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Data Customer</p>
        <div className="relative">
          <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={custName} onChange={e => setCustName(e.target.value)} placeholder="Nama customer"
            className="w-full pl-9 pr-3 py-3 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50" />
        </div>
        <div className="relative">
          <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="tel" value={custPhone} onChange={e => setCustPhone(e.target.value)} placeholder="Nomor WhatsApp (08xxx)"
            className="w-full pl-9 pr-3 py-3 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50" />
        </div>
      </div>

      {sendErr && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{sendErr}</div>}

      <button onClick={sendInvoice} disabled={!canSend || sending}
        className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl text-white font-bold text-sm shadow-xl active:scale-[0.98] transition-all disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg,#16A34A,#22C55E)' }}>
        {sending ? <><Loader2 size={18} className="animate-spin" /> Membuat PDF Invoice...</> : <><Send size={18} /> Kirim Invoice PDF ke WA</>}
      </button>
      <p className="text-center text-gray-400 text-xs pb-2">PDF invoice akan dibagikan langsung ke WhatsApp customer</p>
    </div>
  );

  const renderDone = () => (
    <div className="flex flex-col items-center justify-center py-16 px-6 gap-5 h-full">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle2 size={44} className="text-green-500" />
      </div>
      <div className="text-center">
        <p className="text-lg font-black text-gray-800">Invoice Terkirim!</p>
        <p className="text-sm text-gray-500 mt-2">PDF invoice sudah dibagikan ke<br /><span className="font-bold text-gray-700">{custName}</span> · {custPhone}</p>
        {invoiceNo && <p className="text-xs text-amber-600 mt-1 font-medium">{invoiceNo}</p>}
      </div>
      <div className="bg-amber-50 rounded-2xl border border-amber-100 px-5 py-4 text-xs text-amber-700 text-center w-full leading-relaxed">
        WhatsApp sudah terbuka dengan link invoice PDF. Tinggal tap <strong>Kirim</strong> untuk mengirim ke <strong>{custName}</strong>.
      </div>
      <button onClick={resetPOS}
        className="mt-2 px-8 py-3.5 rounded-2xl text-sm font-bold text-white shadow-lg active:scale-95 transition-transform"
        style={{ background: 'linear-gradient(135deg,#D97706,#EA580C)' }}>
        Transaksi Baru
      </button>
    </div>
  );

  // ── Tabs config ───────────────────────────────────────────────────────────
  const TABS: { id: TabId; label: string; icon: React.ReactNode; shortLabel?: string }[] = [
    { id: 'dashboard',  label: 'Analitik',  shortLabel: 'Analitik',   icon: <BarChart2 size={13} /> },
    { id: 'pos',        label: 'Kasir',     shortLabel: 'Kasir',      icon: <ShoppingCart size={13} /> },
    { id: 'products',   label: 'Produk',    shortLabel: 'Produk',     icon: <Package size={13} /> },
    { id: 'orders',     label: 'Pesanan',   shortLabel: 'Pesanan',    icon: <Receipt size={13} /> },
    { id: 'resellers',  label: 'Reseller',  shortLabel: 'Reseller',   icon: <Users size={13} /> },
    { id: 'stock',      label: 'Gudang',    shortLabel: 'Gudang',     icon: <Warehouse size={13} /> },
    { id: 'settings',   label: 'Pengaturan',shortLabel: 'Setting',    icon: <Settings size={13} /> },
  ];

  // ── Full render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* Header */}
      <div className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/icon-192.png" alt="Cemilan Teh Risma" width={30} height={30} className="rounded-xl shadow-sm" />
            <div>
              <p className="font-bold text-gray-800 text-sm leading-tight">Dashboard Admin</p>
              <p className="text-[10px] text-gray-400 leading-tight">Cemilan Teh Risma</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={MAIN_APP} target="_blank" rel="noopener noreferrer"
              className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"><Home size={15} /></a>
            {activeTab === 'dashboard' && (
              <button onClick={() => fetchStats()} disabled={loading}
                className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors disabled:opacity-50">
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
            )}
            <button onClick={logout}
              className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"><LogOut size={15} /></button>
          </div>
        </div>

        {/* Tabs — horizontal scroll */}
        <div className="max-w-2xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-all border ${
                activeTab === tab.id
                  ? 'text-white border-transparent shadow-md'
                  : 'text-gray-500 bg-white border-gray-200 hover:border-amber-300'
              }`}
              style={activeTab === tab.id ? { background: 'linear-gradient(135deg,#D97706,#EA580C)' } : {}}>
              {tab.icon}
              <span>{tab.shortLabel ?? tab.label}</span>
              {tab.id === 'pos' && hasCart && activeTab !== 'pos' && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">{cartCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Analytics tab ────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        <div className="max-w-2xl mx-auto w-full px-4 py-6 pb-10 space-y-4">
          {statsErr && <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm">{statsErr}</div>}
          <p className="text-gray-400 text-xs text-center">Data 30 hari terakhir</p>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: <Eye size={14} className="text-amber-500"/>, label: 'Pengunjung Unik', val: total?.toLocaleString('id') ?? '–', sub: 'sesi berbeda' },
              { icon: <TrendingUp size={14} className="text-amber-500"/>, label: 'Halaman Dibuka', val: views?.toLocaleString('id') ?? '–', sub: 'total pageview' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1">{c.icon}<span className="text-xs text-gray-400 font-semibold">{c.label}</span></div>
                <p className="text-2xl font-bold text-gray-800">{c.val}</p>
                <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>

          {daily.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2"><BarChart2 size={14} className="text-amber-500"/><span className="text-sm font-bold text-gray-800">Tren 7 Hari</span></div>
                <span className="text-xs text-gray-400">Hari ini: <strong className="text-gray-700">{todayViews}</strong></span>
              </div>
              <MiniBarChart data={daily} />
              <p className="text-xs text-gray-400 text-center mt-2">pageview per hari</p>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3"><Smartphone size={14} className="text-amber-500"/><span className="text-sm font-bold text-gray-800">Perangkat</span></div>
            <div className="flex items-center gap-5">
              <DonutChart mobile={mobile} desktop={desktop} />
              <div className="flex-1 space-y-3">
                {[{label:'Mobile',pct:mPct,cnt:mobile,cls:'bg-amber-500'},{label:'Desktop',pct:dPct,cnt:desktop,cls:'bg-amber-200'}].map(d=>(
                  <div key={d.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${d.cls}`}/>{d.label}</span>
                      <span className="text-xs font-bold text-gray-700">{d.cnt} <span className="text-gray-400 font-normal">({d.pct}%)</span></span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${d.cls} rounded-full`} style={{width:`${d.pct}%`}} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {topPages.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
                <span className="text-sm">🔥</span><p className="text-sm font-bold text-gray-800">Halaman Terpopuler</p>
              </div>
              {topPages.slice(0,5).map((p:unknown,i:number)=>{
                const pg=p as Record<string,unknown>, cnt=pg.visitors as number;
                const pct=Math.round((cnt/((topPages[0] as Record<string,unknown>).visitors as number))*100);
                return (
                  <div key={i} className="px-4 py-3 flex items-center gap-2 border-b border-gray-50 last:border-0">
                    <span className="text-xs font-bold text-gray-300 w-4">{i+1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">{pageLabel(pg.path as string)}</p>
                      <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                        <div className="h-full bg-amber-400 rounded-full" style={{width:`${pct}%`}} />
                      </div>
                    </div>
                    <span className="text-xs font-bold text-gray-600 ml-2">{cnt.toLocaleString('id')}</span>
                  </div>
                );
              })}
            </div>
          )}

          {(total??0)>0&&(views??0)>0&&(
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm text-center">
                <p className="text-xs text-gray-400 font-semibold mb-1">Halaman / Pengunjung</p>
                <p className="text-2xl font-bold text-gray-800">{((views??0)/(total??1)).toFixed(1)}</p>
                <p className="text-xs text-gray-400">rata-rata</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm text-center">
                <p className="text-xs text-gray-400 font-semibold mb-1">Hari Ini</p>
                <p className="text-2xl font-bold text-gray-800">{todayViews}</p>
                <p className="text-xs text-gray-400">pageview</p>
              </div>
            </div>
          )}

          <button onClick={sendWA}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl text-white font-bold text-sm shadow-lg hover:opacity-90 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#16A34A,#22C55E)' }}>
            <MessageCircle size={18} /> Kirim Rekap ke WhatsApp
          </button>

          <p className="text-center text-gray-400/80 text-xs pb-4 border-t border-gray-100 pt-4">
            Dikembangkan oleh{' '}
            <a href="https://eleven-digital.id/" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:underline">PT. Eleven Digital Indonesia</a>
            {' · '}didukung <span className="text-amber-500">PT. RMedia Production</span>
          </p>
        </div>
      )}

      {/* ── POS tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'pos' && (
        <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full overflow-hidden">
          {posView !== 'done' && (
            <div className="px-4 pt-4 pb-2 flex items-center gap-3 flex-shrink-0">
              {posView === 'cart' && (
                <button onClick={() => { setPosView('products'); setSendErr(''); }}
                  className="p-2.5 rounded-xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors flex-shrink-0 shadow-sm">
                  <ChevronLeft size={16} />
                </button>
              )}
              <div className="flex-1">
                <p className="text-sm font-black text-gray-800">{posView === 'products' ? 'Pilih Produk' : 'Detail & Kirim'}</p>
                <p className="text-xs text-gray-400">
                  {posView === 'products' ? `${filteredProducts.length} produk tersedia` : `${cartItems.length} jenis · ${cartCount} pcs`}
                </p>
              </div>
              {posView === 'products' && hasCart && (
                <button onClick={() => setPosView('cart')}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-600 shadow-sm hover:bg-gray-50 transition-colors">
                  <ShoppingCart size={14} />
                  <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">{cartCount}</span>
                </button>
              )}
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            {posView === 'products' && renderProducts()}
            {posView === 'cart'     && renderCart()}
            {posView === 'done'     && renderDone()}
          </div>
        </div>
      )}

      {/* ── Firebase-powered tabs ─────────────────────────────────────────── */}
      {activeTab === 'products'  && <ProductsTab  creds={creds} />}
      {activeTab === 'orders'    && <OrdersTab    creds={creds} />}
      {activeTab === 'resellers' && <ResellersTab creds={creds} />}
      {activeTab === 'stock'     && <StockTab     creds={creds} />}
      {activeTab === 'settings'  && <SettingsTab  creds={creds} />}
    </div>
  );
}
