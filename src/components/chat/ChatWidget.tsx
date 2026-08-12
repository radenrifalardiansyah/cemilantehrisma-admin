'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import ChatPanel from './ChatPanel';

interface Props {
  username: string;
  creds: string;
  avatar: string | null;
}

const HEARTBEAT_MS = 25_000;
const UNREAD_POLL_MS = 20_000;
const CLOSE_ANIM_MS = 160; // matches .animate-scale-out duration in globals.css

export default function ChatWidget({ username, creds, avatar }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [unreadRoomIds, setUnreadRoomIds] = useState<string[]>([]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPanel = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPanelMounted(true);
    setPanelOpen(true);
  };

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    closeTimer.current = setTimeout(() => setPanelMounted(false), CLOSE_ANIM_MS);
  }, []);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const fetchUnread = useCallback(() => {
    fetch('/api/chat/unread', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then((data: { unreadRoomIds: string[] }) => setUnreadRoomIds(data.unreadRoomIds))
      .catch(() => {});
  }, [creds]);

  useEffect(() => {
    const heartbeat = () => fetch('/api/chat/heartbeat', { method: 'POST', headers: { 'x-admin-auth': creds } }).catch(() => {});
    heartbeat();
    const id = setInterval(heartbeat, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [creds]);

  useEffect(() => {
    fetchUnread();
    const id = setInterval(fetchUnread, UNREAD_POLL_MS);
    return () => clearInterval(id);
  }, [fetchUnread]);

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
          unreadRoomIds={unreadRoomIds}
          onRefreshUnread={fetchUnread}
          closing={!panelOpen}
          onClose={closePanel}
        />
      )}
    </>
  );
}
