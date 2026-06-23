'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Trash2, ChevronDown, ChevronUp, Receipt } from 'lucide-react';

const API = '';

interface OrderItem {
  name: string;
  weight: string;
  qty: number;
  price: number;
  subtotal: number;
}

interface Order {
  id: string;
  invoiceNo: string;
  date: string;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  subtotal: number;
  discount?: { amount: number; label: string };
  total: number;
  pdfUrl?: string;
  status: string;
  createdAt?: { seconds: number };
}

const formatRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

function formatDate(o: Order) {
  if (o.createdAt?.seconds) {
    return new Date(o.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return o.date ?? '–';
}

export default function OrdersTab({ creds }: { creds: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const headers = { 'x-admin-auth': creds };

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/orders`, { headers });
    if (r.ok) { const { orders: o } = await r.json() as { orders: Order[] }; setOrders(o); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const del = async (id: string) => {
    if (!confirm('Hapus pesanan ini?')) return;
    await fetch(`${API}/api/orders/${id}`, { method: 'DELETE', headers });
    setOrders(o => o.filter(x => x.id !== id));
  };

  const totalRevenue = orders.reduce((s, o) => s + (o.total ?? 0), 0);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-amber-400" /></div>;

  return (
    <div className="px-4 py-5 pb-10 space-y-4 max-w-2xl mx-auto w-full">

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <p className="text-xs text-gray-400 font-semibold mb-1">Total Transaksi</p>
          <p className="text-2xl font-bold text-gray-800">{orders.length}</p>
          <p className="text-xs text-gray-400">pesanan tercatat</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <p className="text-xs text-gray-400 font-semibold mb-1">Total Omzet</p>
          <p className="text-lg font-bold text-amber-600">{formatRp(totalRevenue)}</p>
          <p className="text-xs text-gray-400">dari semua pesanan</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800">Riwayat Pesanan</p>
        <button onClick={load} disabled={loading}
          className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-amber-200 p-10 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <p className="text-sm font-semibold text-gray-600">Belum ada pesanan</p>
          <p className="text-xs text-gray-400 mt-1">Pesanan dari tab Kasir akan muncul di sini</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(o => (
            <div key={o.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Receipt size={18} className="text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{o.customerName}</p>
                  <p className="text-xs text-gray-400">{o.invoiceNo} · {formatDate(o)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black text-amber-600">{formatRp(o.total)}</p>
                  <p className="text-[10px] text-gray-400">{o.items?.length ?? 0} produk</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                    className="p-2 rounded-xl text-gray-400 hover:bg-gray-100">
                    {expandedId === o.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button onClick={() => del(o.id)} className="p-2 rounded-xl text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                </div>
              </div>

              {expandedId === o.id && (
                <div className="border-t border-gray-50 px-4 pb-4 pt-3 space-y-3">
                  <p className="text-xs text-gray-500">📞 {o.customerPhone}</p>
                  <div className="space-y-1.5">
                    {o.items?.map((item, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-gray-600">{item.name} <span className="text-gray-400">({item.weight})</span> × {item.qty}</span>
                        <span className="font-bold text-gray-700">{formatRp(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>
                  {o.discount && o.discount.amount > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-green-600">Diskon ({o.discount.label})</span>
                      <span className="text-green-600 font-bold">− {formatRp(o.discount.amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-2">
                    <span className="text-gray-700">Total</span>
                    <span className="text-amber-600">{formatRp(o.total)}</span>
                  </div>
                  {o.pdfUrl && (
                    <a href={o.pdfUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-amber-600 hover:underline">
                      <Receipt size={12} /> Lihat Invoice PDF
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
