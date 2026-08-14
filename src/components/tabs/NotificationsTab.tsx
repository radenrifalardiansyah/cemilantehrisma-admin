'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { Bell, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { getClientDb } from '@/lib/firebase-client';
import { useFirebaseSignIn } from '@/lib/useFirebaseSignIn';
import { useViewMode } from '@/lib/useViewMode';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import NotificationDetailModal from '@/components/NotificationDetailModal';
import { TYPE_ICON, timeAgo, type NotificationDoc } from '@/components/NotificationBell';

const HEADER_BTN_H = 34;

// Riwayat lengkap notifikasi — beda dengan dropdown lonceng (NotificationBell) yang cuma
// menampilkan 50 terakhir tanpa pagination. Tab ini ambil batch lebih besar + dipaginasi
// di client, pola yang sama dengan tab-tab lain (Materials, Consignment, dst).
const FETCH_LIMIT = 500;

interface NotificationsTabProps {
  creds: string;
  username: string;
  onOpenNotification: (n: NotificationDoc) => void;
}

export default function NotificationsTab({ creds, username, onOpenNotification }: NotificationsTabProps) {
  const signedIn = useFirebaseSignIn(creds);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<NotificationDoc | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useViewMode('notifications');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    if (!signedIn) return;
    const q = query(collection(getClientDb(), 'notifications'), orderBy('createdAt', 'desc'), limit(FETCH_LIMIT));
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() }) as NotificationDoc));
      setLoading(false);
    }, err => { console.error('Notifications list error', err); setLoading(false); });
    return unsub;
  }, [signedIn]);

  const unread = notifications.filter(n => !n.readBy?.includes(username));

  const markRead = (id: string) => {
    fetch(`/api/notifications/${id}/read`, { method: 'PATCH', headers: { 'x-admin-auth': creds } }).catch(() => {});
  };

  const markAllRead = () => {
    fetch('/api/notifications/read-all', { method: 'PATCH', headers: { 'x-admin-auth': creds } }).catch(() => {});
  };

  const filtered = notifications.filter(n =>
    !search || n.title.toLowerCase().includes(search.toLowerCase()) || n.message.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  const handleClick = (n: NotificationDoc) => {
    if (!n.readBy?.includes(username)) markRead(n.id);
    setDetail(n);
  };

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        {unread.length > 0 && (
          <button onClick={markAllRead} className="btn-ghost h-9 px-3 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
            Tandai semua dibaca
          </button>
        )}
      </TopbarPortal>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 animate-fade-up space-y-4">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Notifikasi</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {unread.length > 0 ? `${unread.length} belum dibaca` : 'Semua sudah dibaca'}
            </p>
          </div>

          {/* Header: search + view toggle */}
          <div className="flex flex-row items-center gap-2 sm:gap-3">
            {notifications.length > 0 && (
              <div className="relative flex-1 min-w-0">
                <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); resetPage(); }}
                  className="input text-sm w-full"
                  style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                  placeholder="Cari judul atau pesan notifikasi…"
                />
              </div>
            )}
            {notifications.length > 0 && (
              <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
                <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
              </div>
            )}
          </div>

          {loading ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Memuat notifikasi…</p>
            </div>
          ) : paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {notifications.length === 0 ? 'Belum ada notifikasi.' : 'Tidak ada notifikasi yang cocok.'}
              </p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((n, idx) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isRead = n.readBy?.includes(username);
                const rowNum = (safePage - 1) * pageSize + idx + 1;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
                    style={{ background: isRead ? 'transparent' : 'var(--accent-bg)' }}
                  >
                    <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-2" style={{ color: 'var(--text-muted)' }}>
                      {rowNum}
                    </span>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                      <Icon size={16} />
                    </div>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                      <span className="block text-xs leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.message}</span>
                      <span className="block text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</span>
                    </span>
                    {!isRead && <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: 'var(--accent)' }} />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(n => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isRead = n.readBy?.includes(username);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className="card overflow-hidden relative p-4 text-left flex flex-col gap-2"
                    style={{ background: isRead ? undefined : 'var(--accent-bg)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}>
                        <Icon size={16} />
                      </div>
                      <span className="text-sm font-bold truncate flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                      {!isRead && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />}
                    </div>
                    <p className="text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>{n.message}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</p>
                  </button>
                );
              })}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} notifikasi · halaman {safePage} dari {totalPages}
                </p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); resetPage(); }} />
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Tooltip label="Halaman sebelumnya">
                    <button onClick={() => goPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronLeft size={14} />
                    </button>
                  </Tooltip>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                    .reduce<(number | '…')[]>((acc, n, i, arr) => {
                      if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(n); return acc;
                    }, [])
                    .map((n, i) =>
                      n === '…'
                        ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                        : <button key={n} onClick={() => goPage(n as number)}
                            className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                            style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                            {n}
                          </button>
                    )
                  }
                  <Tooltip label="Halaman berikutnya">
                    <button onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronRight size={14} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <NotificationDetailModal
        notification={detail}
        onClose={() => setDetail(null)}
        onOpen={n => { onOpenNotification(n); setDetail(null); }}
      />
    </div>
  );
}
