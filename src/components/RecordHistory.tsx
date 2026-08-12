'use client';

// Tombol "Riwayat" per baris + panel collapse riwayat satu record spesifik — dipakai di tiap menu
// transaksi (Pesanan, Produksi, Pembelian Bahan, Konsinyasi, dll) supaya siapa membuat/mengubah/
// menghapus data itu bisa dilihat langsung dari menunya sendiri, tanpa pindah ke halaman Riwayat.
import { useEffect, useState } from 'react';
import { FileClock, ChevronRight, Loader2, User as UserIcon } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import {
  type AuditEntry, ACTION_META, DIRECTION_COLOR, directionFor, avatarIconFor,
  formatDateTime, HistoryEntryDetail,
} from '@/lib/history-format';

// Ikon FileClock dipakai (bukan `History`) supaya tidak bertabrakan secara visual/label dengan
// fitur "Riwayat" bisnis yang sudah ada di beberapa menu (mis. riwayat kirim/rekap per lokasi
// konsinyasi) — tombol ini khusus untuk audit trail (siapa membuat/mengubah/menghapus).
export function RecordHistoryButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Tooltip label={open ? 'Tutup riwayat perubahan' : 'Riwayat perubahan'}>
      <button onClick={onToggle} className="btn-ghost p-2 flex-shrink-0" style={open ? { color: 'var(--accent)' } : undefined}>
        <FileClock size={13} />
      </button>
    </Tooltip>
  );
}

export function RecordHistoryPanel({ creds, entity, entityId }: { creds: string; entity: string; entityId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const qs = new URLSearchParams({ entity, entityId });
      const r = await fetch(`/api/history?${qs.toString()}`, { headers: { 'x-admin-auth': creds } });
      if (!active) return;
      if (r.ok) { const { entries: e } = await r.json() as { entries: AuditEntry[] }; setEntries(e); }
      else setEntries([]);
    })();
    return () => { active = false; };
  }, [creds, entity, entityId]);

  return (
    <div className="px-4 pb-4 pt-3 space-y-2" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Riwayat</p>
      {entries === null ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat perubahan untuk data ini.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map(e => {
            const actionMeta = ACTION_META[e.action];
            const avatarColor = DIRECTION_COLOR[directionFor(e)];
            const expanded = expandedId === e.id;
            return (
              <div key={e.id} className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                <button onClick={() => setExpandedId(cur => cur === e.id ? null : e.id)} className="flex items-center gap-2.5 px-3 py-2.5 w-full text-left">
                  <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: avatarColor.bg, color: avatarColor.color }}>
                    {avatarIconFor(e)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`badge ${actionMeta.badge} text-[10px]`}>{actionMeta.label}</span>
                    <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      <UserIcon size={11} /> {e.actorUsername} ({e.actorRole}) · {formatDateTime(e)}
                    </p>
                  </div>
                  <ChevronRight size={12} style={{ color: 'var(--text-muted)', transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s', flexShrink: 0 }} />
                </button>
                {expanded && <HistoryEntryDetail entry={e} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
