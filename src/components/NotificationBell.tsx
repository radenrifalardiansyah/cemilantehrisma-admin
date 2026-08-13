'use client';

import { useEffect, useRef, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query, limit, Timestamp } from 'firebase/firestore';
import { Bell, ShoppingCart, PackageX, Wallet, ReceiptText, Truck, ClipboardList } from 'lucide-react';
import { getClientAuth, getClientDb, isFirebaseClientConfigured } from '@/lib/firebase-client';
import type { TabId } from '@/components/AppShell';

interface NotificationDoc {
  id: string;
  type: 'order_new' | 'stock_low' | 'pos_shift_open' | 'consignment_overdue' | 'consignment_recap' | 'consignment_send';
  title: string;
  message: string;
  link: string | null;
  readBy: string[];
  createdAt: Timestamp | null;
}

const TYPE_ICON: Record<NotificationDoc['type'], typeof Bell> = {
  order_new: ShoppingCart,
  stock_low: PackageX,
  pos_shift_open: Wallet,
  consignment_overdue: ReceiptText,
  consignment_recap: ClipboardList,
  consignment_send: Truck,
};

function timeAgo(ts: Timestamp | null): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts.toMillis();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Baru saja';
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  return `${Math.floor(hr / 24)} hari lalu`;
}

interface NotificationBellProps {
  creds: string;
  username: string;
  onNavigate: (tab: TabId) => void;
}

export default function NotificationBell({ creds, username, onNavigate }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isFirebaseClientConfigured) return; // env NEXT_PUBLIC_FIREBASE_* belum diisi — fitur nonaktif dulu
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/firebase-token', { headers: { 'x-admin-auth': creds } });
        if (!res.ok) return;
        const { token } = await res.json();
        if (cancelled) return;
        await signInWithCustomToken(getClientAuth(), token);
        if (!cancelled) setSignedIn(true);
      } catch (err) {
        console.error('Gagal sign-in Firebase untuk notifikasi', err);
      }
    })();
    return () => { cancelled = true; };
  }, [creds]);

  useEffect(() => {
    if (!signedIn) return;
    const q = query(collection(getClientDb(), 'notifications'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() }) as NotificationDoc));
    }, err => console.error('Notification listener error', err));
    return unsub;
  }, [signedIn]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const unread = notifications.filter(n => !n.readBy?.includes(username));

  const markRead = (id: string) => {
    fetch(`/api/notifications/${id}/read`, { method: 'PATCH', headers: { 'x-admin-auth': creds } }).catch(() => {});
  };

  const markAllRead = () => {
    fetch('/api/notifications/read-all', { method: 'PATCH', headers: { 'x-admin-auth': creds } }).catch(() => {});
  };

  const handleClick = (n: NotificationDoc) => {
    if (!n.readBy?.includes(username)) markRead(n.id);
    setOpen(false);
    if (n.link) onNavigate(n.link as TabId);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifikasi"
        className="relative flex items-center justify-center h-9 w-9 rounded-lg transition-colors"
        style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
      >
        <Bell size={16} />
        {unread.length > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[9px] font-black text-white"
            style={{ minWidth: 16, height: 16, padding: '0 3px', background: 'var(--danger)' }}
          >
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 rounded-xl shadow-lg overflow-hidden z-50"
          style={{ width: 340, maxWidth: '90vw', background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Notifikasi</span>
            {unread.length > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                Tandai semua dibaca
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto thin-scrollbar">
            {notifications.length === 0 && (
              <p className="px-3.5 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                Belum ada notifikasi.
              </p>
            )}
            {notifications.map(n => {
              const Icon = TYPE_ICON[n.type] ?? Bell;
              const isRead = n.readBy?.includes(username);
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="w-full flex items-start gap-2.5 px-3.5 py-3 text-left transition-colors"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: isRead ? 'transparent' : 'var(--accent-bg)',
                  }}
                >
                  <Icon size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                    <span className="block text-xs leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.message}</span>
                    <span className="block text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</span>
                  </span>
                  {!isRead && <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: 'var(--accent)' }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
