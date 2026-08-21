export const BRAND_NAME = 'Cemilan Teh Risma';

export const ADMIN_APP_NAME = 'Admin Teh Risma';
export const ADMIN_APP_TITLE = `Dashboard Admin — ${BRAND_NAME}`;
export const ADMIN_APP_DESCRIPTION = `Admin dashboard ${BRAND_NAME}`;
export const ADMIN_MANIFEST_DESCRIPTION = `Dashboard Admin ${BRAND_NAME} — kelola produk, pesanan, stok, dan analitik toko.`;

export const WHATSAPP_NUMBER = '6281212132014';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cemilantehrisma.eleven-digital.id';
export const productUrl = (id: string) => `${SITE_URL}/products/${id}`;

export const THEME_COLOR = '#D4691E';
export const THEME_BACKGROUND_COLOR = '#1C1917';

export const DEVELOPER = {
  name: 'PT. Eleven Digital Indonesia',
  url: 'https://www.eleven-digital.id',
  supportedBy: 'RMedia Solutions',
};
