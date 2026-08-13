import { getApps, initializeApp, cert, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';

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

export function getFirebaseAuth() {
  return getAuth(getApp());
}
