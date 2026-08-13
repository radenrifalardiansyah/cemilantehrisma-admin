'use client';

import { useCallback, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import ChatRoomList, { Contact } from './ChatRoomList';
import ChatThread from './ChatThread';
import { TEAM_ROOM_ID, directRoomId, SerializedTimestamp } from '@/lib/chat';
import { useVisiblePolling } from '@/lib/useVisiblePolling';

type Account = { username: string; role: string; avatar: string | null; lastLoginAt: SerializedTimestamp | null };

export type ActiveRoom = { kind: 'team' } | { kind: 'direct'; contact: Contact };

interface Props {
  username: string;
  avatar: string | null;
  creds: string;
  accounts: Account[];
  initialActiveRoom: ActiveRoom | null;
  unreadRoomIds: string[];
  onRefreshUnread: () => void;
  closing: boolean;
  onClose: () => void;
}

// Was 10s — this scans the entire `users` collection on every call, so it's the poll
// most sensitive to team size. Panel is also only mounted while the widget is open.
const PRESENCE_POLL_MS = 20_000;

export default function ChatPanel({ username, avatar, creds, accounts, initialActiveRoom, unreadRoomIds, onRefreshUnread, closing, onClose }: Props) {
  // Seeded once from a resolved deep link (push notification click, see ChatWidget.tsx) —
  // ChatPanel only mounts once that resolution is already done, so a lazy initializer is
  // enough here; no effect needed to react to it arriving later.
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(() => initialActiveRoom);
  const [onlineMap, setOnlineMap] = useState<Record<string, boolean>>({});
  const [onlineCount, setOnlineCount] = useState(0);

  const fetchPresence = useCallback(() => {
    fetch('/api/chat/presence', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then((data: { accounts: { username: string; online: boolean }[]; onlineCount: number }) => {
        setOnlineMap(Object.fromEntries(data.accounts.map(a => [a.username, a.online])));
        setOnlineCount(data.onlineCount);
      })
      .catch(() => {});
  }, [creds]);

  useVisiblePolling(fetchPresence, PRESENCE_POLL_MS, [fetchPresence]);

  const contacts: Contact[] = accounts
    .filter(a => a.username !== username)
    .map(a => ({ username: a.username, role: a.role, avatar: a.avatar, online: onlineMap[a.username] ?? false, lastLoginAt: a.lastLoginAt }));

  return (
    <>
      {/* Transparent click-outside catcher — dismisses the panel without dimming the page,
          since this is a docked widget, not a modal dialog. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 44, pointerEvents: closing ? 'none' : 'auto' }} onClick={onClose} />

      <div
        className={`chat-panel ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
        onClick={e => e.stopPropagation()}
      >
        {!activeRoom && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px',
            borderBottom: '1px solid var(--border-2)', flexShrink: 0,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <MessageCircle size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Akun &amp; Chat</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{onlineCount} sedang online</p>
            </div>
            <button onClick={onClose} className="modal-close"><X size={14} /></button>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: activeRoom ? 'hidden' : 'auto' }}>
          {!activeRoom && (
            <ChatRoomList
              username={username}
              avatar={avatar}
              contacts={contacts}
              selfOnline={onlineMap[username] ?? true}
              unreadRoomIds={unreadRoomIds}
              onSelectTeam={() => setActiveRoom({ kind: 'team' })}
              onSelectContact={contact => setActiveRoom({ kind: 'direct', contact })}
            />
          )}
          {activeRoom && (
            <ChatThread
              roomId={activeRoom.kind === 'team' ? TEAM_ROOM_ID : directRoomId(username, activeRoom.contact.username)}
              title={activeRoom.kind === 'team' ? 'Chat Tim' : activeRoom.contact.username}
              avatarUsername={activeRoom.kind === 'direct' ? activeRoom.contact.username : undefined}
              avatarUrl={activeRoom.kind === 'direct' ? activeRoom.contact.avatar : null}
              username={username}
              creds={creds}
              onBack={() => setActiveRoom(null)}
              onClose={onClose}
              onMarkedRead={onRefreshUnread}
            />
          )}
        </div>
      </div>
    </>
  );
}
