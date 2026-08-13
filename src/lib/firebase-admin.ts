import { getApps, initializeApp, cert, App } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getMessaging } from 'firebase-admin/messaging';

let app: App;

function getApp(): App {
  if (getApps().length) return getApps()[0]!;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? '{}';
  const sa = JSON.parse(raw) as Parameters<typeof cert>[0];
  app = initializeApp({
    credential: cert(sa),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
  return app;
}

export function getDb() {
  return getFirestore(getApp());
}

export function getBucket() {
  return getStorage(getApp()).bucket();
}

export function getFirebaseMessaging() {
  return getMessaging(getApp());
}

// Admin SDK Timestamp exposes `seconds`/`nanoseconds` as prototype getters, not own
// enumerable properties — JSON.stringify (i.e. Response.json()) silently serializes the
// private `_seconds`/`_nanoseconds` fields instead, breaking any client code reading
// `.seconds`. Convert explicitly before returning a Timestamp from an API route.
export function serializeTimestamp(ts: Timestamp | null | undefined): { seconds: number; nanoseconds: number } | null {
  if (!ts) return null;
  return { seconds: ts.seconds, nanoseconds: ts.nanoseconds };
}
