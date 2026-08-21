import type { MetadataRoute } from 'next';
import { getCachedAdminBranding } from '@/lib/server/branding';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getCachedAdminBranding();
  return {
    name: branding.appName,
    short_name: branding.appName,
    description: `Dashboard Admin ${branding.storeName} — kelola produk, pesanan, stok, dan analitik toko.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: branding.themeBackgroundColor,
    theme_color: branding.themeColor,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
