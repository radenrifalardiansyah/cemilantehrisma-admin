'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Trash2, Smartphone, Globe, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useViewMode } from '@/lib/useViewMode';

interface StorefrontCustomer {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  authProvider?: 'google';
  createdAt?: { seconds: number };
}

function formatDate(c: StorefrontCustomer) {
  if (c.createdAt?.seconds)
    return new Date(c.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return '-';
}

// Akun yang customer buat sendiri di storefront untuk checkout — beda dengan tab
// "Pelanggan" (kontak CRM yang diinput admin secara manual). Read-only kecuali
// hapus akun (mis. spam/duplikat); admin tidak pernah membuat/mengedit akun ini.
export default function StorefrontCustomersTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<StorefrontCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useViewMode('storefront-customers');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/storefront-customers', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then(d => setCustomers(d.customers ?? []))
      .catch(() => toast.error('Gagal memuat akun storefront.'))
      .finally(() => setLoading(false));
  }, [creds, toast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (c: StorefrontCustomer) => {
    if (!await confirm({ message: `Hapus akun "${c.name || c.phone}"? Pemilik akun tidak akan bisa login lagi.`, danger: true })) return;
    try {
      const res = await fetch(`/api/storefront-customers/${c.id}`, { method: 'DELETE', headers: { 'x-admin-auth': creds } });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal menghapus akun.'); return; }
      toast.success('Akun berhasil dihapus.');
      load();
    } catch {
      toast.error('Gagal menghapus akun.');
    }
  };

  const filtered = customers.filter(c =>
    !search
    || c.name?.toLowerCase().includes(search.toLowerCase())
    || c.phone?.includes(search)
    || c.email?.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const resetPage = () => setPage(1);

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
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Akun Storefront</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Akun yang customer buat sendiri di website untuk checkout — {customers.length} akun terdaftar.
            </p>
          </div>

          <div className="flex flex-row items-center gap-2 sm:gap-3">
            <div className="relative flex-1 min-w-0">
              <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); resetPage(); }}
                className="input text-sm w-full"
                style={{ paddingLeft: 38, height: 34 }}
                placeholder="Cari nama, nomor HP, atau email…"
              />
            </div>
            <ViewToggle mode={view} onChange={setView} height={34} />
          </div>

          {loading ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Memuat akun…</p>
            </div>
          ) : paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {customers.length === 0 ? 'Belum ada akun terdaftar.' : 'Tidak ada akun yang cocok.'}
              </p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                    {c.authProvider === 'google' ? <Globe size={16} /> : <Smartphone size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.name || '(tanpa nama)'}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{c.phone}{c.email ? ` · ${c.email}` : ''}</p>
                  </div>
                  <span className="text-[11px] hidden sm:block flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {c.authProvider === 'google' ? 'Google' : 'HP + Password'} · {formatDate(c)}
                  </span>
                  <Tooltip label="Hapus akun">
                    <button onClick={() => handleDelete(c)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(c => (
                <div key={c.id} className="card p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                      {c.authProvider === 'google' ? <Globe size={16} /> : <Smartphone size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.name || '(tanpa nama)'}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{c.phone}{c.email ? ` · ${c.email}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {c.authProvider === 'google' ? 'Google' : 'HP + Password'} · {formatDate(c)}
                    </span>
                    <button onClick={() => handleDelete(c)} className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} akun · halaman {safePage} dari {totalPages}
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
