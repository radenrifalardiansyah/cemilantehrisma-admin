export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cemilantehrisma.eleven-digital.id';

export const productUrl = (id: string) => `${SITE_URL}/products/${id}`;
