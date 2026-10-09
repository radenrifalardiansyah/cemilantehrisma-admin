import { getDb } from '@/lib/firebase-admin';
import { logHistory } from '@/lib/history';
import type { AuthUser } from '@/lib/admin-auth';

// Catat audit log Titip Jual; kegagalan menulis log tidak boleh menggagalkan mutasi bisnis.
export async function auditConsign(
  actor: AuthUser, action: 'create' | 'update' | 'delete', kind: string,
  entityId: string, label: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null,
): Promise<void> {
  try {
    await logHistory(getDb(), {
      entity: 'consign', entityCollection: kind, entityId, entityLabel: label, action, actor, before, after,
    });
  } catch (err) {
    console.error('Failed to write consign audit log', err);
  }
}
