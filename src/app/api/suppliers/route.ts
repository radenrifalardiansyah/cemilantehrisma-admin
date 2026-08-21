import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

const SUPPLIER_CODE_PREFIX = 'SUP';

// Opened whenever the Supplier tab is opened, not on every session — plain TTL (no
// invalidation tag) is enough here, same tradeoff as getAllUsernames/modules-and-menus.
const getCachedSuppliers = unstable_cache(
  async () => {
    const db = getDb();
    const snap = await db.collection('suppliers').orderBy('createdAt', 'asc').get();
    const suppliers: Record<string, unknown>[] = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    let maxCode = 0;
    for (const s of suppliers) {
      const m = new RegExp(`^${SUPPLIER_CODE_PREFIX}(\\d+)$`, 'i').exec(typeof s.code === 'string' ? s.code.trim() : '');
      if (m) maxCode = Math.max(maxCode, parseInt(m[1], 10));
    }
    const missing = suppliers.filter(s => !(typeof s.code === 'string' && s.code.trim()));
    if (missing.length > 0) {
      const batch = db.batch();
      for (const s of missing) {
        maxCode += 1;
        const code = `${SUPPLIER_CODE_PREFIX}${String(maxCode).padStart(3, '0')}`;
        s.code = code;
        batch.update(db.collection('suppliers').doc(s.id as string), { code });
      }
      await batch.commit();
    }
    return suppliers;
  },
  ['admin-suppliers'],
  { revalidate: 20 },
);

function nextSupplierCode(existingCodes: string[]) {
  let max = 0;
  for (const c of existingCodes) {
    const m = new RegExp(`^${SUPPLIER_CODE_PREFIX}(\\d+)$`, 'i').exec(c.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${SUPPLIER_CODE_PREFIX}${String(max + 1).padStart(3, '0')}`;
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'suppliers', 'view');
  if (guard instanceof Response) return guard;
  const suppliers = await getCachedSuppliers();
  return Response.json({ suppliers });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'suppliers', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const existingSnap = await db.collection('suppliers').get();
  const existingCodes = existingSnap.docs.map(d => ((d.data().code as string) ?? '').trim()).filter(Boolean);
  const code = nextSupplierCode(existingCodes);
  const ref = await db.collection('suppliers').add({
    code,
    name: data.name,
    phone: data.phone ?? '',
    address: data.address ?? '',
    note: data.note ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id, code });
}
