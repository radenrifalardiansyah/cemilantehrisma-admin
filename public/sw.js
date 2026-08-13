// Push notification (FCM) — nilai di bawah ini publik/aman diekspos (sama dengan
// NEXT_PUBLIC_FIREBASE_* di .env.local), tapi harus di-hardcode di sini karena service worker
// statis tidak bisa membaca process.env saat runtime browser.
importScripts('https://www.gstatic.com/firebasejs/12.4.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.4.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCc1xWpz6hcrVI5Q1eSWhBXuNWZDRAVfXY',
  authDomain: 'cemilantehrisma.firebaseapp.com',
  projectId: 'cemilantehrisma',
  messagingSenderId: '661399440965',
  appId: '1:661399440965:web:317a97da1ac1ca972b5d2c',
});
const messaging = firebase.messaging();

// Notifikasi cuma muncul dari sini kalau tab admin panel sedang di background/tertutup —
// kalau tab sedang aktif, bell in-app (NotificationBell.tsx) yang menangani secara realtime.
messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification?.title ?? 'Notifikasi baru', {
    body: payload.notification?.body ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data ?? {},
  });
});

// Notifikasi chat bawa `chatRoomId` di data payload (lihat src/lib/notifications.ts sendPush) —
// arahkan langsung ke room itu lewat query string, dibaca oleh ChatWidget.tsx saat mount.
// Fokus tab admin yang sudah terbuka kalau ada, daripada selalu buka tab baru.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const roomId = event.notification.data?.chatRoomId;
  const url = roomId ? `/?chatRoom=${encodeURIComponent(roomId)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client && 'navigate' in client) {
          return client.navigate(url).then((c) => c.focus());
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

const CACHE_NAME = 'ctr-admin-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Jangan campur tangan request cross-origin (terutama koneksi realtime Firestore ke
  // firestore.googleapis.com, dipakai NotificationBell) — Firestore pakai streaming/long-polling
  // khusus yang rusak kalau lewat respondWith() service worker. Cache offline cukup untuk aset
  // same-origin milik app ini sendiri.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
