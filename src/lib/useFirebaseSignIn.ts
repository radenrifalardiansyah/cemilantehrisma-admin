'use client';

import { useEffect, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { getClientAuth, isFirebaseClientConfigured } from '@/lib/firebase-client';

// Sign-in ke Firebase Auth client SDK pakai custom token dari sesi admin (`creds`) — dipakai
// bareng oleh NotificationBell & NotificationsTab supaya logic-nya tidak dobel di dua tempat.
export function useFirebaseSignIn(creds: string): boolean {
  const [signedIn, setSignedIn] = useState(false);

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
        console.error('Gagal sign-in Firebase', err);
      }
    })();
    return () => { cancelled = true; };
  }, [creds]);

  return signedIn;
}
