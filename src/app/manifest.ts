import type { MetadataRoute } from 'next';
import { ADMIN_APP_NAME, ADMIN_MANIFEST_DESCRIPTION, THEME_COLOR, THEME_BACKGROUND_COLOR } from '@/lib/branding';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: ADMIN_APP_NAME,
    short_name: ADMIN_APP_NAME,
    description: ADMIN_MANIFEST_DESCRIPTION,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: THEME_BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
