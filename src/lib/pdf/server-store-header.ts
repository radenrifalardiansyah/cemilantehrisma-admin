import { getDb } from '@/lib/firebase-admin';
import { getSettings } from '@/lib/settings-pg';
import type { StoreHeader } from './ShipmentNotePDF';

// Header toko untuk PDF yang dirender di server. Logo disimpan di Firestore (`images`) — satu baca
// per PDF akan menghabiskan kuota baca Firestore kalau link sering dibuka (WA preview, buka ulang),
// jadi hasil data-URI di-cache di memori instance serverless selama 1 jam per logo.
const LOGO_TTL_MS = 60 * 60 * 1000;
const logoCache = new Map<string, { value: string | undefined; at: number }>();

async function resolveLogoDataUri(logoUrl?: string): Promise<string | undefined> {
  if (!logoUrl) return undefined;
  const match = logoUrl.match(/\/api\/img\/([^/?#]+)/);
  if (!match) return logoUrl;
  const hit = logoCache.get(match[1]);
  if (hit && Date.now() - hit.at < LOGO_TTL_MS) return hit.value;
  const doc = await getDb().collection('images').doc(match[1]).get();
  let value: string | undefined;
  if (doc.exists) {
    const { data, contentType } = doc.data() as { data: Buffer; contentType?: string };
    value = `data:${contentType || 'image/jpeg'};base64,${Buffer.from(data).toString('base64')}`;
  }
  logoCache.set(match[1], { value, at: Date.now() });
  return value;
}

export async function getServerStoreHeader(): Promise<StoreHeader> {
  const settings = await getSettings() as {
    storeName?: string; storeTagline?: string; address?: string; city?: string; whatsapp?: string; logo?: string;
  };
  return {
    name: settings.storeName?.trim() || 'Cemilan Teh Risma',
    tagline: settings.storeTagline?.trim() || undefined,
    address: [settings.address, settings.city].filter(Boolean).join(', ') || undefined,
    phone: settings.whatsapp?.trim() || undefined,
    logo: await resolveLogoDataUri(settings.logo),
  };
}
