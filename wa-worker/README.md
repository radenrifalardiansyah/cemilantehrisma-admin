# Worker Teruskan Stok WA

Membaca grup WhatsApp mitra dan meneruskan pesan stok (yang memuat kata kunci) ke grup kita. Pengaturannya ada di admin:
**Mitra → Teruskan Stok WA**. Worker ini harus jalan di perangkat yang menyala terus (laptop/PC/server) — **bukan di Vercel**.

> Pakai **nomor cadangan**, bukan nomor utama. Baileys bukan API resmi WhatsApp, ada risiko nomor diblokir.

## Persiapan sekali saja
1. Node.js 20+ terpasang.
2. Di Vercel (Settings → Environment Variables) tambahkan `WA_WORKER_SECRET` = string acak panjang
   (buat dengan `openssl rand -hex 32`), lalu redeploy.
3. Di folder ini: `cp .env.example .env`, isi `ADMIN_BASE_URL` dan `WA_WORKER_SECRET` (nilai sama dengan di Vercel).
4. `npm install`

## Menjalankan
```
npm start
```
Pertama kali muncul QR di terminal: di HP nomor cadangan buka WhatsApp → **Perangkat tertaut → Tautkan perangkat** → scan.
Sesi disimpan di `.auth/` (jangan dibagikan/di-commit), jadi berikutnya tidak perlu scan lagi.

Lalu di admin: buka **Teruskan Stok WA** → grup yang diikuti nomor itu sudah terdaftar → pasangkan ke mitra, pilih grup tujuan,
cek kata kunci, centang **Aktifkan**.

## Catatan
- Nomor cadangan harus sudah dimasukkan ke grup mitra dan grup tujuan.
- Pesan yang masuk saat worker mati diteruskan begitu menyala lagi (maks. 24 jam ke belakang), antrean dikirim berjeda 4–10 detik.
- Antrean ada di memori: kalau worker dimatikan saat antrean belum habis, pesannya tetap tercatat berstatus *Menunggu* di riwayat admin.
- Ter-logout dari HP? Hapus folder `.auth/` lalu `npm start` dan scan QR baru.
- Mengubah logika filter/format: ubah `filter.mjs` **dan** `src/lib/wa-forward.ts` (dijaga `src/lib/wa-worker-parity.test.ts`).
