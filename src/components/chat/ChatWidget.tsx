'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import ChatPanel, { ActiveRoom } from './ChatPanel';
import { useVisiblePolling } from '@/lib/useVisiblePolling';
import { SerializedTimestamp, TEAM_ROOM_ID } from '@/lib/chat';

interface Props {
  username: string;
  creds: string;
  avatar: string | null;
}

const HEARTBEAT_MS = 25_000;
// Was 20s — /api/chat/unread does an N+1 read (all users + 2 doc reads per other user) on
// every call, so this poll's frequency directly multiplies Firestore read volume.
const UNREAD_POLL_MS = 45_000;
const CLOSE_ANIM_MS = 160; // matches .animate-scale-out duration in globals.css

type Account = { username: string; role: string; avatar: string | null; lastLoginAt: SerializedTimestamp | null };

// Resolves a `chatRoom` deep-link query param (set by public/sw.js on a push notification
// click) into the ActiveRoom shape ChatPanel expects, once the account list is in hand.
function resolveDeepLinkRoom(roomId: string, accounts: Account[], username: string): ActiveRoom | null {
  if (roomId === TEAM_ROOM_ID) return { kind: 'team' };
  if (!roomId.startsWith('dm_')) return null;
  const otherUsername = roomId.slice(3).split('~').find(u => u !== username);
  const account = accounts.find(a => a.username === otherUsername);
  if (!account) return null;
  return { kind: 'direct', contact: { username: account.username, role: account.role, avatar: account.avatar, online: false, lastLoginAt: account.lastLoginAt } };
}

export default function ChatWidget({ username, creds, avatar }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [unreadRoomIds, setUnreadRoomIds] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [initialActiveRoom, setInitialActiveRoom] = useState<ActiveRoom | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetched here (on widget mount, i.e. page load) rather than in ChatPanel (on panel open) so
  // the "Semua Akun" list is already warm by the time the user clicks the chat icon — avoids
  // the popup opening onto an empty list while the fetch is still in flight. Also resolves any
  // pending chat deep link (push notification click, see public/sw.js) in the same callback,
  // once accounts are actually available, and opens straight into that room.
  useEffect(() => {
    const pendingRoomId = new URLSearchParams(window.location.search).get('chatRoom');
    fetch('/api/chat/accounts', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then((data: { accounts: Account[] }) => {
        setAccounts(data.accounts);
        if (!pendingRoomId) return;
        window.history.replaceState({}, '', window.location.pathname);
        const resolved = resolveDeepLinkRoom(pendingRoomId, data.accounts, username);
        if (!resolved) return;
        setInitialActiveRoom(resolved);
        setPanelMounted(true);
        setPanelOpen(true);
      })
      .catch(() => {});
  }, [creds, username]);

  const openPanel = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPanelMounted(true);
    setPanelOpen(true);
  };

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    closeTimer.current = setTimeout(() => { setPanelMounted(false); setInitialActiveRoom(null); }, CLOSE_ANIM_MS);
  }, []);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const fetchUnread = useCallback(() => {
    fetch('/api/chat/unread', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then((data: { unreadRoomIds: string[] }) => setUnreadRoomIds(data.unreadRoomIds))
      .catch(() => {});
  }, [creds]);

  const heartbeat = useCallback(() => {
    fetch('/api/chat/heartbeat', { method: 'POST', headers: { 'x-admin-auth': creds } }).catch(() => {});
  }, [creds]);

  useVisiblePolling(heartbeat, HEARTBEAT_MS, [heartbeat]);
  useVisiblePolling(fetchUnread, UNREAD_POLL_MS, [fetchUnread]);

  const unreadCount = unreadRoomIds.length;

  return (
    <>
      <button
        onClick={() => (panelOpen ? closePanel() : openPanel())}
        aria-label="Akun & Chat"
        className="chat-fab"
        style={{
          width: 44, height: 44, borderRadius: '50%',
          background: panelOpen ? 'var(--accent-dark)' : 'var(--accent)',
          color: '#fff', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: panelOpen ? '0 2px 10px rgba(0,0,0,0.28)' : '0 2px 10px rgba(212,105,30,0.30)',
          transition: 'background 0.2s ease, box-shadow 0.2s ease',
        }}
      >
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: panelOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
        }}>
          {panelOpen ? <X size={19} /> : <MessageCircle size={19} />}
        </span>
        {unreadCount > 0 && (
          <span
            className="absolute w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center"
            style={{ top: -3, right: -3, border: '2px solid var(--surface)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {panelMounted && (
        <ChatPanel
          username={username}
          avatar={avatar}
          creds={creds}
          accounts={accounts}
          initialActiveRoom={initialActiveRoom}
          unreadRoomIds={unreadRoomIds}
          onRefreshUnread={fetchUnread}
          closing={!panelOpen}
          onClose={closePanel}
        />
      )}
    </>
  );
}
