import { FieldValue, Firestore, Transaction } from 'firebase-admin/firestore';
import type { AuthUser } from '@/lib/admin-auth';

// Notifikasi in-app broadcast ke semua admin, dibaca realtime lewat Firestore client SDK
// (lihat src/lib/firebase-client.ts) — mengikuti konvensi src/lib/history.ts: writeNotification
// dipanggil di dalam transaksi milik caller tepat setelah mutasi bisnisnya, notify dipakai di
// route yang tidak membuka transaksi sendiri.

export type NotificationType =
  | 'order_new' | 'stock_low' | 'pos_shift_open' | 'consignment_overdue' | 'consignment_recap' | 'consignment_send';

interface NotificationOpts {
  type: NotificationType;
  title: string;
  message: string;
  /** TabId admin (mis. 'orders', 'materials') — app ini SPA berbasis activeTab, bukan URL route. */
  link?: string;
  entityCollection?: string;
  entityId?: string;
  actor: AuthUser;
}

function buildNotificationDoc(opts: NotificationOpts) {
  return {
    type: opts.type,
    title: opts.title,
    message: opts.message,
    link: opts.link ?? null,
    entityCollection: opts.entityCollection ?? null,
    entityId: opts.entityId ?? null,
    actorUsername: opts.actor.username,
    actorRole: opts.actor.role,
    readBy: [] as string[],
    createdAt: FieldValue.serverTimestamp(),
  };
}

export function writeNotification(tx: Transaction, db: Firestore, opts: NotificationOpts): void {
  tx.set(db.collection('notifications').doc(), buildNotificationDoc(opts));
}

export async function notify(db: Firestore, opts: NotificationOpts): Promise<void> {
  await db.collection('notifications').add(buildNotificationDoc(opts));
}
