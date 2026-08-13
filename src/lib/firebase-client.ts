'use client';

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';

// Firebase client SDK dipakai HANYA untuk mendengarkan koleksi `notifications` secara realtime
// (lihat NotificationBell.tsx) — semua data bisnis lain tetap lewat Admin SDK di server seperti
// biasa. Sign-in pakai custom token (bukan email/password), lihat /api/auth/firebase-token.
//
// Inisialisasi sengaja LAZY (baru dibuat saat dipanggil, bukan di top-level modul) — kalau tidak,
// import modul ini saja sudah men-trigger `getAuth()` yang melempar error keras kalau env var
// NEXT_PUBLIC_FIREBASE_* belum diisi, dan itu terjadi juga saat SSR/build karena AppShell
// dirender di server, bisa menjatuhkan seluruh build admin bukan cuma fitur notifikasi ini.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseClientConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.appId);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

function getClientApp(): FirebaseApp {
  if (!app) app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
  return app;
}

export function getClientDb(): Firestore {
  if (!db) db = getFirestore(getClientApp());
  return db;
}

export function getClientAuth(): Auth {
  if (!auth) auth = getAuth(getClientApp());
  return auth;
}

let messaging: Messaging | null = null;

// Async & bisa null — beberapa browser (Safari desktop lama, Firefox private mode, dst) tidak
// dukung Push API sama sekali; isSupported() dari SDK adalah cara resmi mengeceknya sebelum init.
export async function getClientMessaging(): Promise<Messaging | null> {
  if (messaging) return messaging;
  if (!(await isSupported())) return null;
  messaging = getMessaging(getClientApp());
  return messaging;
}
