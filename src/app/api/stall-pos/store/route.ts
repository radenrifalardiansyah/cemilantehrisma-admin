import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getSettings } from '@/lib/settings-pg';

// Identitas toko untuk struk Kasir Lapak. Endpoint /api/settings butuh izin 'settings' (berisi
// pengaturan lain yang tidak boleh dibaca kasir), jadi di sini hanya nama, alamat, dan logo.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-pos', 'view');
  if (guard instanceof Response) return guard;
  const s = await getSettings() as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return Response.json({
    store: {
      name: str(s.storeName) || 'Cemilan Teh Risma',
      address: [str(s.address), str(s.city)].filter(Boolean).join(', '),
      logo: str(s.logo),
      whatsapp: str(s.whatsapp),
    },
  });
}
