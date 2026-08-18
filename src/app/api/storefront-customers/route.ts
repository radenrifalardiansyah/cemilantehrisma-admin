import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

// Akun yang customer buat sendiri di storefront (register/login/Google) untuk bisa checkout —
// koleksi `storefront_customers`, TERPISAH dari `customers` (kontak CRM yang diinput manual di
// tab Pelanggan). Jangan disatukan; keduanya sengaja punya bentuk data yang berbeda.
const getCachedStorefrontCustomers = unstable_cache(
  async () => {
    const snap = await getDb().collection('storefront_customers').orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-storefront-customers'],
  { revalidate: 15 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'storefront-customers', 'view');
  if (guard instanceof Response) return guard;
  const customers = await getCachedStorefrontCustomers();
  return Response.json({ customers });
}
