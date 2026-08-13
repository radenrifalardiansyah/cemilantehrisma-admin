'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, Send, Users, X } from 'lucide-react';
import ChatAvatar from './ChatAvatar';
import { TEAM_ROOM_ID } from '@/lib/chat';
import { useVisiblePolling } from '@/lib/useVisiblePolling';

interface Message {
  id: string;
  text: string;
  senderUsername: string;
  createdAt: string | null;
  read: boolean;
}

interface Props {
  roomId: string;
  title: string;
  avatarUsername?: string;
  avatarUrl?: string | null;
  username: string;
  creds: string;
  onBack: () => void;
  onClose: () => void;
  onMarkedRead: () => void;
}

const POLL_MS = 4_000;

export default function ChatThread({
  roomId, title, avatarUsername, avatarUrl, username, creds, onBack, onClose, onMarkedRead,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const lastCreatedAtRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headers = { 'x-admin-auth': creds };

  const markRead = useCallback(() => {
    fetch(`/api/chat/rooms/${roomId}/read`, { method: 'POST', headers: { 'x-admin-auth': creds } })
      .then(onMarkedRead)
      .catch(() => {});
  }, [roomId, creds, onMarkedRead]);

  const loadMessages = useCallback(async (initial: boolean) => {
    const url = initial
      ? `/api/chat/rooms/${roomId}/messages`
      : `/api/chat/rooms/${roomId}/messages?after=${encodeURIComponent(lastCreatedAtRef.current ?? '')}`;
    try {
      const r = await fetch(url, { headers: { 'x-admin-auth': creds } });
      if (!r.ok) return;
      const data = await r.json() as { messages: Message[] };
      if (data.messages.length === 0) return;
      lastCreatedAtRef.current = data.messages[data.messages.length - 1].createdAt;
      setMessages(prev => (initial ? data.messages : [...prev, ...data.messages]));
      if (!initial && data.messages.some(m => m.senderUsername !== username)) markRead();
    } catch {
      // polling — transient failures are ignored, next tick retries
    }
  }, [roomId, creds, username, markRead]);

  const refreshReadReceipts = useCallback(async () => {
    try {
      const r = await fetch(`/api/chat/rooms/${roomId}/reads`, { headers: { 'x-admin-auth': creds } });
      if (!r.ok) return;
      const { readWatermark } = await r.json() as { readWatermark: string | null };
      if (!readWatermark) return;
      const watermarkMs = new Date(readWatermark).getTime();
      setMessages(prev => prev.map(m => (
        !m.read && m.senderUsername === username && m.createdAt && new Date(m.createdAt).getTime() <= watermarkMs
          ? { ...m, read: true }
          : m
      )));
    } catch {
      // polling — transient failures are ignored, next tick retries
    }
  }, [roomId, creds, username]);

  useEffect(() => {
    setMessages([]);
    lastCreatedAtRef.current = null;
    loadMessages(true).then(markRead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const pollTick = useCallback(() => { loadMessages(false); refreshReadReceipts(); }, [loadMessages, refreshReadReceipts]);
  useVisiblePolling(pollTick, POLL_MS, [pollTick]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    try {
      const r = await fetch(`/api/chat/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (r.ok) await loadMessages(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-2)', flexShrink: 0 }}>
        <button onClick={onBack} className="modal-close" style={{ borderRadius: 9 }}><ArrowLeft size={15} /></button>
        {avatarUsername
          ? <ChatAvatar name={avatarUsername} avatar={avatarUrl ?? null} size={32} />
          : (
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Users size={15} />
            </div>
          )}
        <p style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</p>
        <button onClick={onClose} className="modal-close"><X size={14} /></button>
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface-2)' }}>
        {messages.map(m => {
          const mine = m.senderUsername === username;
          const time = m.createdAt
            ? new Date(m.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            : '';
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '75%', padding: '8px 12px', fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word',
                background: mine ? 'var(--accent)' : 'var(--surface)',
                color: mine ? '#fff' : 'var(--text-primary)',
                borderRadius: mine ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                boxShadow: mine ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
              }}>
                {roomId === TEAM_ROOM_ID && !mine && (
                  <p style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.7, marginBottom: 2 }}>{m.senderUsername}</p>
                )}
                {m.text}
              </div>
              {(time || mine) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {time}
                  {mine && (m.read
                    ? <CheckCheck size={13} style={{ color: 'var(--info)' }} />
                    : <Check size={13} />)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="modal-footer">
        <input
          className="input" placeholder="Ketik pesan…" value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ flex: 1 }}
        />
        <button onClick={send} disabled={!text.trim() || sending} className="btn-primary" style={{ padding: '0 14px' }}>
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
