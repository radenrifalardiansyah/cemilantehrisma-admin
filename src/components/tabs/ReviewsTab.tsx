'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Trash2, Star, Check, X, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import PageSizeSelect from '@/components/PageSizeSelect';

interface StorefrontReview {
  id: string;
  customerId?: string;
  customerName?: string;
  rating?: number;
  comment?: string;
  approved?: boolean;
  createdAt?: { seconds: number };
}

type StatusFilter = 'all' | 'pending' | 'approved';

function formatDate(r: StorefrontReview) {
  if (r.createdAt?.seconds)
    return new Date(r.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return '-';
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={13} style={{ color: 'var(--warning, #F59E0B)' }} fill={i <= rating ? 'currentColor' : 'none'} />
      ))}
    </div>
  );
}

// Ulasan bintang dari akun storefront (halaman /pesanan) — hanya customer dengan
// pesanan "selesai" yang bisa mengirim. Baru dihitung ke rating publik di beranda
// storefront setelah di-approve di sini (lihat storefront's /api/stats/public).
export default function ReviewsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [reviews, setReviews] = useState<StorefrontReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/reviews', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then(d => setReviews(d.reviews ?? []))
      .catch(() => toast.error('Gagal memuat ulasan.'))
      .finally(() => setLoading(false));
  }, [creds, toast]);

  useEffect(() => { load(); }, [load]);

  const setApproved = async (r: StorefrontReview, approved: boolean) => {
    try {
      const res = await fetch(`/api/reviews/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-auth': creds },
        body: JSON.stringify({ approved }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal memperbarui ulasan.'); return; }
      toast.success(approved ? 'Ulasan disetujui & tayang di beranda.' : 'Ulasan disembunyikan dari beranda.');
      load();
    } catch {
      toast.error('Gagal memperbarui ulasan.');
    }
  };

  const handleDelete = async (r: StorefrontReview) => {
    if (!await confirm({ message: `Hapus ulasan dari "${r.customerName}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    try {
      const res = await fetch(`/api/reviews/${r.id}`, { method: 'DELETE', headers: { 'x-admin-auth': creds } });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal menghapus ulasan.'); return; }
      toast.success('Ulasan berhasil dihapus.');
      load();
    } catch {
      toast.error('Gagal menghapus ulasan.');
    }
  };

  const filtered = reviews
    .filter(r => status === 'all' || (status === 'approved' ? r.approved : !r.approved))
    .filter(r =>
      !search || r.customerName?.toLowerCase().includes(search.toLowerCase()) || r.comment?.toLowerCase().includes(search.toLowerCase())
    );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const resetPage = () => setPage(1);
  const pendingCount = reviews.filter(r => !r.approved).length;

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Muat ulang">
          <button onClick={load} className="btn-ghost p-2"><RefreshCw size={15} /></button>
        </Tooltip>
      </TopbarPortal>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 animate-fade-up space-y-4">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Ulasan</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {pendingCount > 0 ? `${pendingCount} ulasan menunggu persetujuan` : 'Semua ulasan sudah ditinjau'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <div className="relative flex-1 min-w-0">
              <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); resetPage(); }}
                className="input text-sm w-full"
                style={{ paddingLeft: 38, height: 34 }}
                placeholder="Cari nama atau isi ulasan…"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {(['all', 'pending', 'approved'] as StatusFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => { setStatus(s); resetPage(); }}
                  className="h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors"
                  style={status === s ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}
                >
                  {s === 'all' ? 'Semua' : s === 'pending' ? 'Menunggu' : 'Disetujui'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Memuat ulasan…</p>
            </div>
          ) : paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {reviews.length === 0 ? 'Belum ada ulasan masuk.' : 'Tidak ada ulasan yang cocok.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paginated.map(r => (
                <div key={r.id} className="card p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{r.customerName || '(tanpa nama)'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Stars rating={r.rating ?? 0} />
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatDate(r)}</span>
                      </div>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0"
                      style={r.approved
                        ? { background: 'var(--success-bg, #DCFCE7)', color: 'var(--success, #16A34A)' }
                        : { background: 'var(--warning-bg, #FEF3C7)', color: 'var(--warning, #D97706)' }}
                    >
                      {r.approved ? 'Disetujui' : 'Menunggu'}
                    </span>
                  </div>
                  {r.comment && (
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{r.comment}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {r.approved ? (
                      <button onClick={() => setApproved(r, false)} className="btn-ghost h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
                        <X size={13} /> Sembunyikan
                      </button>
                    ) : (
                      <button onClick={() => setApproved(r, true)} className="btn-primary h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
                        <Check size={13} /> Setujui
                      </button>
                    )}
                    <Tooltip label="Hapus ulasan">
                      <button onClick={() => handleDelete(r)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                        <Trash2 size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} ulasan · halaman {safePage} dari {totalPages}
                </p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); resetPage(); }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
