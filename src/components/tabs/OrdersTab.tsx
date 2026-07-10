'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Trash2, ChevronDown, ChevronUp, Receipt, TrendingUp, ShoppingBag } from 'lucide-react';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';

interface OrderItem { name: string; weight: string; qty: number; price: number; subtotal: number; }
interface Order {
  id: string; invoiceNo: string; date: string; customerName: string; customerPhone: string;
  items: OrderItem[]; subtotal: number; discount?: { amount: number; label: string };
  total: number; pdfUrl?: string; status: string; createdAt?: { seconds: number };
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

function formatDate(o: Order) {
  if (o.createdAt?.seconds)
    return new Date(o.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return o.date ?? '–';
}

export default function OrdersTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [orders,     setOrders]     = useState<Order[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useViewMode('orders');

  const headers = { 'x-admin-auth': creds };

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/orders`, { headers });
    if (r.ok) { const { orders: o } = await r.json() as { orders: Order[] }; setOrders(o); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const del = async (id: string) => {
    if (!await confirm({ message: 'Hapus pesanan ini? Tindakan ini tidak bisa dibatalkan.', danger: true })) return;
    const r = await fetch(`${API}/api/orders/${id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setOrders(o => o.filter(x => x.id !== id));
      toast.success('Pesanan berhasil dihapus.');
    } else {
      toast.error('Gagal menghapus pesanan.');
    }
  };

  const totalRevenue = orders.reduce((s, o) => s + (o.total ?? 0), 0);
  const avgOrder     = orders.length ? totalRevenue / orders.length : 0;

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Pesanan</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Riwayat transaksi dari kasir</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle mode={view} onChange={setView} />
          <button onClick={load} disabled={loading} className="btn-ghost p-2.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <ShoppingBag size={16}/>, label: 'Total Transaksi', val: orders.length.toString(), sub: 'pesanan' },
          { icon: <TrendingUp  size={16}/>, label: 'Total Omzet',     val: formatRp(totalRevenue), sub: 'dari semua pesanan' },
          { icon: <Receipt     size={16}/>, label: 'Rata-rata Order', val: formatRp(avgOrder), sub: 'per transaksi' },
        ].map((c, i) => (
          <div key={i} className="card relative p-4 overflow-hidden">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              {c.icon}
            </div>
            <p className="text-lg font-extrabold tabular leading-tight" style={{ color: 'var(--text-primary)' }}>{c.val}</p>
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            <div className="stat-card-accent" />
          </div>
        ))}
      </div>

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🧾</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada pesanan</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pesanan dari tab Kasir akan muncul di sini otomatis.</p>
        </div>
      ) : view === 'table' ? (
        <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
          {orders.map(o => (
            <div key={o.id}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--accent-bg)' }}>
                  <Receipt size={17} style={{ color: 'var(--accent)' }} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                  <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                    {o.invoiceNo} · {formatDate(o)}
                  </p>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.items?.length ?? 0} produk</p>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)} className="btn-ghost p-2">
                    {expandedId === o.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  <button onClick={() => del(o.id)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {expandedId === o.id && <OrderDetail o={o} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map(o => (
            <div key={o.id} className="card overflow-hidden">
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent-bg)' }}>
                    <Receipt size={17} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                    <p className="text-xs tabular truncate" style={{ color: 'var(--text-muted)' }}>
                      {o.invoiceNo} · {formatDate(o)}
                    </p>
                  </div>
                  <button onClick={() => del(o.id)} className="btn-ghost p-2 flex-shrink-0" style={{ color: 'var(--danger)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <div>
                    <p className="text-base font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.items?.length ?? 0} produk</p>
                  </div>
                  <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                    className="btn-ghost px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1">
                    Detail {expandedId === o.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>
              </div>

              {expandedId === o.id && <OrderDetail o={o} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ o }: { o: Order }) {
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>📞 {o.customerPhone}</p>

      <div className="space-y-1.5">
        {o.items?.map((item, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span style={{ color: 'var(--text-secondary)' }}>
              {item.name} <span style={{ color: 'var(--text-muted)' }}>({item.weight})</span> × {item.qty}
            </span>
            <span className="font-bold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(item.subtotal)}</span>
          </div>
        ))}
      </div>

      {o.discount && o.discount.amount > 0 && (
        <div className="flex justify-between text-xs">
          <span style={{ color: 'var(--success)' }}>Diskon ({o.discount.label})</span>
          <span className="font-bold tabular" style={{ color: 'var(--success)' }}>− {formatRp(o.discount.amount)}</span>
        </div>
      )}

      <div className="flex justify-between text-sm font-bold pt-2"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        <span>Total</span>
        <span className="tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</span>
      </div>

      {o.pdfUrl && (
        <a href={o.pdfUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--accent)' }}>
          <Receipt size={12} /> Lihat Invoice PDF →
        </a>
      )}
    </div>
  );
}
