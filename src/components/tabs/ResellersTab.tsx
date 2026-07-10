'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, ChevronDown, ChevronUp, Check, X, Users, UserCheck, UserX, Clock } from 'lucide-react';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import ScrollChips from '@/components/ScrollChips';
import { useToast } from '@/components/Toast';

const API = '';

interface Reseller {
  id: string; name: string; phone: string; address: string; city: string;
  bankName: string; bankAccount: string; bankHolder: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: { seconds: number };
}

function formatDate(r: Reseller) {
  if (r.createdAt?.seconds)
    return new Date(r.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return '–';
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge badge-amber',
  approved: 'badge badge-green',
  rejected: 'badge badge-red',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak',
};

export default function ResellersTab({ creds }: { creds: string }) {
  const toast = useToast();
  const [resellers,  setResellers]  = useState<Reseller[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter,     setFilter]     = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [view, setView] = useViewMode('resellers');

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/resellers`, { headers });
    if (r.ok) { const { resellers: rs } = await r.json() as { resellers: Reseller[] }; setResellers(rs); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: 'approved' | 'rejected') => {
    const r = await fetch(`${API}/api/resellers/${id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ status }),
    });
    if (r.ok) {
      setResellers(rs => rs.map(x => x.id === id ? { ...x, status } : x));
      toast.success(status === 'approved' ? 'Reseller berhasil disetujui.' : 'Reseller berhasil ditolak.');
    } else {
      toast.error('Gagal mengubah status reseller.');
    }
  };

  const counts = {
    all: resellers.length,
    pending:  resellers.filter(r => r.status === 'pending').length,
    approved: resellers.filter(r => r.status === 'approved').length,
    rejected: resellers.filter(r => r.status === 'rejected').length,
  };

  const visible = filter === 'all' ? resellers : resellers.filter(r => r.status === filter);

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
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Reseller</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Kelola pendaftar reseller</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle mode={view} onChange={setView} />
          <button onClick={load} className="btn-ghost p-2.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { icon: <Users     size={15}/>, label: 'Total',     val: counts.all,      color: 'var(--accent)' },
          { icon: <Clock     size={15}/>, label: 'Menunggu',  val: counts.pending,  color: 'var(--warning)' },
          { icon: <UserCheck size={15}/>, label: 'Disetujui', val: counts.approved, color: 'var(--success)' },
          { icon: <UserX     size={15}/>, label: 'Ditolak',   val: counts.rejected, color: 'var(--danger)' },
        ].map((c, i) => (
          <div key={i} className="card p-3.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2.5"
              style={{ background: 'var(--accent-bg)', color: c.color }}>
              {c.icon}
            </div>
            <p className="text-xl font-extrabold tabular" style={{ color: c.color }}>{c.val}</p>
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filter chips */}
      <ScrollChips gap="gap-2">
        {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`tab-chip ${filter === f ? 'active' : ''}`}
          >
            {f === 'all' ? 'Semua' : STATUS_LABEL[f]}
            <span className="ml-1 text-[10px] font-black opacity-70">({counts[f]})</span>
          </button>
        ))}
      </ScrollChips>

      {/* List */}
      {visible.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">👥</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            {filter === 'all' ? 'Belum ada reseller' : `Tidak ada reseller ${STATUS_LABEL[filter].toLowerCase()}`}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pendaftar reseller dari toko utama akan muncul di sini.</p>
        </div>
      ) : view === 'table' ? (
        <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
          {visible.map(r => (
            <div key={r.id}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-sm"
                  style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                  {r.name.charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{r.name}</p>
                    <span className={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {r.city} · {formatDate(r)}
                  </p>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <ResellerActions r={r} updateStatus={updateStatus} />
                  <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="btn-ghost p-2">
                    {expandedId === r.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>
              </div>

              {expandedId === r.id && <ResellerDetail r={r} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(r => (
            <div key={r.id} className="card overflow-hidden">
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-sm"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{r.name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {r.city} · {formatDate(r)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <span className={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</span>
                  <div className="flex items-center gap-1">
                    <ResellerActions r={r} updateStatus={updateStatus} />
                    <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      className="btn-ghost px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1">
                      Detail {expandedId === r.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>
              </div>

              {expandedId === r.id && <ResellerDetail r={r} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResellerActions({ r, updateStatus }: { r: Reseller; updateStatus: (id: string, status: 'approved' | 'rejected') => void }) {
  if (r.status === 'pending') return (
    <>
      <button
        onClick={() => updateStatus(r.id, 'approved')}
        className="p-2 rounded-xl transition-colors"
        style={{ background: 'var(--success-bg)', color: 'var(--success)' }}
        title="Setujui"
      >
        <Check size={13} />
      </button>
      <button
        onClick={() => updateStatus(r.id, 'rejected')}
        className="p-2 rounded-xl transition-colors"
        style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
        title="Tolak"
      >
        <X size={13} />
      </button>
    </>
  );
  if (r.status === 'approved') return (
    <button
      onClick={() => updateStatus(r.id, 'rejected')}
      className="btn-ghost p-2 text-[11px] font-semibold"
      style={{ color: 'var(--danger)' }}
    >
      Cabut
    </button>
  );
  return (
    <button
      onClick={() => updateStatus(r.id, 'approved')}
      className="btn-ghost p-2 text-[11px] font-semibold"
      style={{ color: 'var(--success)' }}
    >
      Setujui
    </button>
  );
}

function ResellerDetail({ r }: { r: Reseller }) {
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {[
          { label: 'No. HP', val: r.phone },
          { label: 'Kota', val: r.city },
          { label: 'Alamat', val: r.address },
          { label: 'Bank', val: r.bankName },
          { label: 'No. Rekening', val: r.bankAccount },
          { label: 'Atas Nama', val: r.bankHolder },
        ].map((f, i) => (
          <div key={i}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>{f.label}</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{f.val || '–'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
