'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { getClientDb } from '@/lib/firebase-client';
import { useFirebaseSignIn } from '@/lib/useFirebaseSignIn';
import type { NotificationDoc } from '@/components/NotificationBell';

// NotificationBell (dropdown, wants 50) and NotificationsTab (full history, wants 500) used to
// each run their own onSnapshot on the same `notifications` collection — every session paid for
// two live listeners instead of one. 500 is a superset of 50 ordered the same way, so one shared
// listener here covers both; consumers just read what they need from the same list.
const FETCH_LIMIT = 500;

interface NotificationsContextValue {
  notifications: NotificationDoc[];
  loading: boolean;
}

const NotificationsContext = createContext<NotificationsContextValue>({ notifications: [], loading: true });

export function useNotifications(): NotificationsContextValue {
  return useContext(NotificationsContext);
}

export function NotificationsProvider({ creds, children }: { creds: string; children: ReactNode }) {
  const signedIn = useFirebaseSignIn(creds);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!signedIn) return;
    const q = query(collection(getClientDb(), 'notifications'), orderBy('createdAt', 'desc'), limit(FETCH_LIMIT));
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() }) as NotificationDoc));
      setLoading(false);
    }, err => { console.error('Notifications listener error', err); setLoading(false); });
    return unsub;
  }, [signedIn]);

  return (
    <NotificationsContext.Provider value={{ notifications, loading }}>
      {children}
    </NotificationsContext.Provider>
  );
}
