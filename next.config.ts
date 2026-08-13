import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // firebase-admin/auth (jwks-rsa -> jose ESM) gagal di-bundle Turbopack/webpack di server —
  // ERR_REQUIRE_ESM. serverExternalPackages membiarkan Node require() langsung saat runtime,
  // yang menangani interop ESM/CJS ini dengan benar (fix resmi dari dokumentasi Next.js).
  serverExternalPackages: ['firebase-admin'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
    ],
  },
};

export default nextConfig;
