import type { Firestore } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';
import type { AuthUser } from '@/lib/admin-auth';
import type { LinkDiff } from '@/lib/closing-settlement';

// Riwayat (audit) perubahan tautan transfer <-> closing. Satu entri entity `closings` per closing terdampak;
// entri entity `wallet-transfers` hanya bila `logTransfer` (rute Closing; di POST/PUT transfer, tautan ikut
// dicatat di snapshot transfer itu sendiri). Gagal menulis riwayat tidak boleh menggagalkan operasi.
export async function logLinkChanges(db: Firestore, actor: AuthUser, a: {
  transferId: string; transferLabel: string; diff: LinkDiff; periodTo: Record<string, string>;
  logTransfer?: boolean; reason?: string;
}) {
  const when = (id: string) => a.periodTo[id] ?? id;
  const writes: Promise<unknown>[] = [];
  const add = (closingId: string, before: object | null, after: object | null, what: string) => {
    writes.push(logHistory(db, {
      entity: 'closings', entityId: closingId, entityLabel: `${what} closing sampai ${when(closingId)}`,
      action: 'update', actor, before, after, meta: { walletTransferId: a.transferId, ...(a.reason ? { reason: a.reason } : {}) },
    }));
  };
  for (const d of a.diff.added) add(d.closingId, null, { walletTransferId: a.transferId, amount: d.amount }, 'Tautan transfer ditambahkan ke');
  for (const d of a.diff.changed) add(d.closingId, { walletTransferId: a.transferId, amount: d.before }, { walletTransferId: a.transferId, amount: d.after }, 'Nominal tautan transfer diubah pada');
  for (const d of a.diff.removed) add(d.closingId, { walletTransferId: a.transferId, amount: d.amount }, null, 'Tautan transfer dilepas dari');
  if (a.logTransfer) {
    writes.push(logHistory(db, {
      entity: 'wallet-transfers', entityId: a.transferId, entityLabel: a.transferLabel, action: 'update', actor,
      before: { closingLinks: [...a.diff.removed, ...a.diff.changed.map(c => ({ closingId: c.closingId, amount: c.before }))] },
      after: { closingLinks: [...a.diff.added, ...a.diff.changed.map(c => ({ closingId: c.closingId, amount: c.after }))] },
      meta: a.reason ? { reason: a.reason } : undefined,
    }));
  }
  const results = await Promise.allSettled(writes);
  for (const r of results) if (r.status === 'rejected') console.error('Failed to write history for closing settlement', r.reason);
}
