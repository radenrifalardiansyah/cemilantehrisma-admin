import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

const LOCATION_CODE_PREFIX = 'MTR';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const db = getDb();
  const snap = await db.collection('consignmentLocations').orderBy('createdAt', 'asc').get();
  const locations: Record<string, unknown>[] = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  let maxCode = 0;
  for (const l of locations) {
    const m = /^MTR(\d+)$/i.exec(typeof l.code === 'string' ? l.code.trim() : '');
    if (m) maxCode = Math.max(maxCode, parseInt(m[1], 10));
  }
  const missing = locations.filter(l => !(typeof l.code === 'string' && l.code.trim()));
  if (missing.length > 0) {
    const batch = db.batch();
    for (const l of missing) {
      maxCode += 1;
      const code = `${LOCATION_CODE_PREFIX}${String(maxCode).padStart(3, '0')}`;
      l.code = code;
      batch.update(db.collection('consignmentLocations').doc(l.id as string), { code });
    }
    await batch.commit();
  }

  return Response.json({ locations });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const codeTrim = typeof data.code === 'string' ? data.code.trim() : '';
  if (codeTrim) {
    const dup = await db.collection('consignmentLocations').where('code', '==', codeTrim).limit(1).get();
    if (!dup.empty) {
      return Response.json({ error: `Kode "${codeTrim}" sudah digunakan lokasi lain.` }, { status: 409 });
    }
  }
  const ref = await db.collection('consignmentLocations').add({
    name: data.name,
    code: codeTrim,
    contactName: data.contactName ?? '',
    contactPhone: data.contactPhone ?? '',
    address: data.address ?? '',
    note: data.note ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
