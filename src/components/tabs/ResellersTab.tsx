'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Check, X, ChevronDown, ChevronUp, Users } from 'lucide-react';

const API = '';

interface Reseller {
  id: string;
  nama: string;
  whatsapp: string;
  kota: string;
  alamat: string;
  platform: string[];
  paket: string;
  pengalaman: string;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: { seconds: number };
}

function statusBadge(s?: string) {
  if (s === 'approved') return 'bg-green-100 text-green-700';
  if (s === 'rejected') return 'bg-red-100 text-red-600';
  return 'bg-amber-100 text-amber-700';
}
function statusLabel(s?: string) {
  if (s === 'approved') return 'Diterima';
  if (s === 'rejected') return 'Ditolak';
  return 'Pending';
}

export default function ResellersTab({ creds }: { creds: string }) {
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/resellers`, { headers });
    if (r.ok) { const { resellers: rs } = await r.json() as { resellers: Reseller[] }; setResellers(rs); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    await fetch(`${API}/api/resellers/${id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ status }),
    });
    setResellers(rs => rs.map(r => r.id === id ? { ...r, status } : r));
  };

  const formatDate = (r: Reseller) => {
    if (r.createdAt?.seconds) {
      return new Date(r.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return '–';
  };

  const counts = {
    total: resellers.length,
    pending: resellers.filter(r => !r.status || r.status === 'pending').length,
    approved: resellers.filter(r => r.status === 'approved').length,
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-amber-400" /></div>;

  return (
    <div className="px-4 py-5 pb-10 space-y-4 max-w-2xl mx-auto w-full">

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Total', val: counts.total, cls: 'text-gray-800' },
          { label: 'Pending', val: counts.pending, cls: 'text-amber-600' },
          { label: 'Diterima', val: counts.approved, cls: 'text-green-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-gray-100 p-3 shadow-sm text-center">
            <p className={`text-xl font-bold ${c.cls}`}>{c.val}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800">Pendaftar Reseller</p>
        <button onClick={load} className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200">
          <RefreshCw size={14} />
        </button>
      </div>

      {resellers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-amber-200 p-10 text-center">
          <div className="text-4xl mb-3">🤝</div>
          <p className="text-sm font-semibold text-gray-600">Belum ada pendaftar reseller</p>
          <p className="text-xs text-gray-400 mt-1">Pendaftar dari form di main app akan muncul di sini</p>
        </div>
      ) : (
        <div className="space-y-2">
          {resellers.map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                  <Users size={18} className="text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-gray-800 truncate">{r.nama}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0 ${statusBadge(r.status)}`}>{statusLabel(r.status)}</span>
                  </div>
                  <p className="text-xs text-gray-400">{r.kota} · {formatDate(r)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {(!r.status || r.status === 'pending') && (
                    <>
                      <button onClick={() => setStatus(r.id, 'approved')}
                        className="p-2 rounded-xl text-green-500 hover:bg-green-50"><Check size={14} /></button>
                      <button onClick={() => setStatus(r.id, 'rejected')}
                        className="p-2 rounded-xl text-red-400 hover:bg-red-50"><X size={14} /></button>
                    </>
                  )}
                  <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="p-2 rounded-xl text-gray-400 hover:bg-gray-100">
                    {expandedId === r.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>

              {expandedId === r.id && (
                <div className="border-t border-gray-50 px-4 pb-4 pt-3 space-y-1.5 text-xs text-gray-600">
                  <p>📞 <a href={`https://wa.me/${r.whatsapp}`} target="_blank" rel="noopener noreferrer" className="text-green-600 underline">{r.whatsapp}</a></p>
                  <p>📍 {r.alamat}</p>
                  <p>📦 Paket: <strong>{r.paket || '–'}</strong></p>
                  <p>🛒 Platform: {r.platform?.join(', ') || '–'}</p>
                  {r.pengalaman && <p>💼 Pengalaman: {r.pengalaman}</p>}
                  {r.status === 'approved' && (
                    <button onClick={() => setStatus(r.id, 'rejected')}
                      className="mt-2 text-xs text-red-400 hover:underline">Ubah ke Ditolak</button>
                  )}
                  {r.status === 'rejected' && (
                    <button onClick={() => setStatus(r.id, 'approved')}
                      className="mt-2 text-xs text-green-600 hover:underline">Ubah ke Diterima</button>
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
