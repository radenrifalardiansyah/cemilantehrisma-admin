# Admin Cemilan Teh Risma

Panel admin (Next.js) untuk toko: Kasir, Pesanan, Stok multi-gudang, Konsinyasi, Produksi, Keuangan, dan pengaturan.
Berbagi satu database Postgres (Supabase) dengan aplikasi website pelanggan (repo `cemilantehrisma`).

> Next.js di proyek ini versi baru dengan perubahan API — baca [AGENTS.md](AGENTS.md) dan dokumen di
> `node_modules/next/dist/docs/` sebelum menulis kode.

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # cek build produksi
npm test         # tes unit (Vitest) — logika murni, tanpa database
npm run lint
```

### Environment variable (`.env.local`, jangan di-commit)
`DATABASE_URL` (pooler) · `DIRECT_URL` (koneksi langsung, untuk skrip) · `JWT_SECRET` ·
`FIREBASE_SERVICE_ACCOUNT` (JSON) · `NEXT_PUBLIC_FIREBASE_*` · `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` /
`SUPABASE_SECRET_KEY` / `SUPABASE_JWKS_URL` · `CLOUDINARY_*` · `REVALIDATE_SECRET` · `NEXT_PUBLIC_API_URL`
(alamat website pelanggan) · `CRON_SECRET` (hanya untuk endpoint pengingat piutang).

## Arsitektur singkat
- **Postgres (Supabase)**: semua data bisnis — pesanan, stok, dompet, voucher, dsb. Skema diubah lewat skrip di `scripts/`.
- **Firebase Auth/Supabase Auth**: verifikasi password login. Sesi admin = JWT sendiri (`src/lib/admin-auth.ts`).
- **Firestore**: hanya notifikasi in-app & token push (`notifications`, `fcmTokens`).
- **Izin**: RBAC per fitur (`src/lib/permissions.ts`, `src/lib/rbac.ts`); super admin punya semua izin.
- Logika yang menyentuh uang/stok selalu di dalam satu transaksi Postgres dengan baris dikunci (`for update`) dan urutan kunci
  seragam (produk → gudang → stok titip) supaya tidak deadlock.

## Skrip migrasi database (`scripts/`)
Semua **aditif dan aman diulang** (`if not exists`). Jalankan sekali per environment: `node scripts/<nama>.mjs`
(memakai `DIRECT_URL` dari `.env.local`). Di environment baru jalankan berurutan:

| Skrip | Isi |
|---|---|
| `add-order-due-date` | `orders.due_date` — jatuh tempo pesanan kredit |
| `add-order-returns` | `orders.returns` — riwayat retur per item |
| `create-vouchers` | tabel `vouchers` + `orders.voucher_code` |
| `add-voucher-per-customer-limit` | `vouchers.per_customer_limit` |
| `add-invoice-token` | `invoices.token` — token di link PDF invoice publik |
| `add-profile-2fa` | kolom TOTP di `profiles` (autentikasi 2 langkah) |
| `create-order-payments` | tabel `order_payments` — cicilan/DP pesanan kredit |
| `add-stock-ledger-opname-cols` | `stock_ledger.unit_cost` & `kind` — selisih opname di Laporan Keuangan |

Skrip lama (`add-wallet-bank-name`, `add-master-bank-logo`, `add-consignment-location-logo`, `create-login-approval-tables`,
`add-fk-constraints`, …) sudah dijalankan di produksi. `seed-admin.mjs` membuat akun super admin pertama.

## GitHub Actions (`.github/workflows/`)
- **Supabase Keepalive** — tiap Senin, mencegah project Supabase gratis di-pause. Butuh secret `DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT`.
  (Memakai Node 22 karena `firebase-admin` 14 mensyaratkannya.)
- **Pengingat piutang jatuh tempo** (`overdue-orders.yml`) — **jadwal otomatis sengaja dimatikan**; hanya bisa dijalankan manual.
  Untuk mengaktifkan: isi secret `ADMIN_BASE_URL` & `CRON_SECRET` (sama dengan env di hosting), lalu buka komentar `schedule`.

## Menguji dengan aman (JANGAN arahkan uji ke produksi)
`.env.local` menunjuk ke database dan Firebase **produksi**. Menjalankan aplikasi dengan env itu lalu membuat transaksi uji akan
menulis ke produksi (termasuk notifikasi push ke HP admin). Cara aman yang dipakai selama pengembangan:
1. `pg_dump --schema-only --schema=public` dari produksi (hanya baca), muat ke Postgres lokal sementara (`initdb` + `pg_ctl`).
2. Jalankan `next dev` dengan `DATABASE_URL`/`DIRECT_URL` ke database lokal itu, `JWT_SECRET` bebas, dan
   `FIREBASE_SERVICE_ACCOUNT` **palsu** (kunci RSA acak dengan project fiktif) — Google menolak semua permintaannya, jadi tidak ada
   tulis ke Firestore produksi. Buat token admin uji sendiri dengan `jsonwebtoken` memakai `JWT_SECRET` itu.
3. Panggil API dengan skrip, bersihkan, lalu hentikan server dan hapus database lokal.

## Hal yang perlu diingat
- **Voucher**: dikelola di Pengaturan → Voucher Diskon; dipakai di Kasir dan checkout website. Potongan **selalu dihitung ulang
  di server**. Voucher dengan "Maks. per Pelanggan" butuh identitas pelanggan (akun / nomor HP ≥ 9 digit).
- **Cicilan/DP**: pesanan yang punya baris `order_payments` dihitung ke saldo dompet dari pembayarannya, bukan dari total pesanan.
  Pendapatan di Laporan Keuangan tetap diakui saat pesanan lunas penuh.
- **Stok opname**: selisih dicatat di buku stok (`kind = 'opname'`, dinilai pada Harga Modal) dan ikut Laba Bersih.
- **Link invoice publik** memuat token (`?t=`); invoice lama tanpa token tetap terbuka agar link yang sudah terkirim tidak putus.
