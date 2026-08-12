'use client';

import { Users } from 'lucide-react';
import ChatAvatar from './ChatAvatar';
import StatusDot from './StatusDot';
import { TEAM_ROOM_ID, directRoomId, formatLastSeen, SerializedTimestamp } from '@/lib/chat';

export interface Contact {
  username: string;
  role: string;
  avatar: string | null;
  online: boolean;
  lastLoginAt: SerializedTimestamp | null;
}

interface Props {
  username: string;
  avatar: string | null;
  contacts: Contact[];
  selfOnline: boolean;
  unreadRoomIds: string[];
  onSelectTeam: () => void;
  onSelectContact: (contact: Contact) => void;
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
  padding: '10px 22px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
};
const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
  color: 'var(--text-muted)', padding: '14px 22px 4px',
};
const unreadDotStyle: React.CSSProperties = { width: 10, height: 10, borderRadius: '50%', background: '#EF4444', flexShrink: 0 };

export default function ChatRoomList({
  username, avatar, contacts, selfOnline, unreadRoomIds, onSelectTeam, onSelectContact,
}: Props) {
  const teamUnread = unreadRoomIds.includes(TEAM_ROOM_ID);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <button onClick={onSelectTeam} style={rowStyle}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Users size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Chat Tim</p>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Ruang chat bersama semua akun</p>
        </div>
        {teamUnread && <span style={unreadDotStyle} />}
      </button>

      <p style={sectionLabelStyle}>Akun Anda</p>
      <div style={{ ...rowStyle, cursor: 'default' }}>
        <div className="relative" style={{ flexShrink: 0 }}>
          <ChatAvatar name={username} avatar={avatar} />
          <span style={{ position: 'absolute', bottom: -1, right: -1 }}>
            <StatusDot online={selfOnline} />
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
            {username} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(Anda)</span>
          </p>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{selfOnline ? 'Online' : 'Offline'}</p>
        </div>
      </div>

      <p style={sectionLabelStyle}>Semua Akun</p>
      {contacts.map(c => {
        const unread = unreadRoomIds.includes(directRoomId(username, c.username));
        return (
          <button key={c.username} onClick={() => onSelectContact(c)} style={rowStyle}>
            <div className="relative" style={{ flexShrink: 0 }}>
              <ChatAvatar name={c.username} avatar={c.avatar} />
              <span style={{ position: 'absolute', bottom: -1, right: -1 }}>
                <StatusDot online={c.online} />
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{c.username}</p>
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.online ? 'Online' : formatLastSeen(c.lastLoginAt)}</p>
            </div>
            {unread && <span style={unreadDotStyle} />}
          </button>
        );
      })}
    </div>
  );
}
