import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// RBAC: tiap endpoint memakai feature 'consignment' dengan aksi yang benar, dan bila izin ditolak workflow tak dipanggil.
const h = vi.hoisted(() => ({ allow: false, calls: [] as [unknown, string][] }));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(async (_req: unknown, key: unknown, action: string) => {
    h.calls.push([key, action]);
    return h.allow ? { username: 'u', role: 'admin' } : Response.json({ error: 'Forbidden' }, { status: 403 });
  }),
}));
vi.mock('@/lib/consignment-transfer-workflow', () => ({
  approveTransfer: vi.fn(async () => ({})), rejectTransfer: vi.fn(async () => {}), cancelTransfer: vi.fn(async () => {}),
  deleteTransfer: vi.fn(async () => {}), updateTransferDraft: vi.fn(async () => {}),
  createTransferDraft: vi.fn(async () => ({ id: 'N1', docNumber: 'TMP-1' })),
  revalidateTransferCaches: vi.fn(), TRANSFERS_LIST_TAG: 'x', CONSIGNMENT_ANALYTICS_TAG: 'y',
  TransferActionError: class extends Error { constructor(m: string, public status = 400) { super(m); } },
}));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));

import * as wf from '@/lib/consignment-transfer-workflow';
import * as list from './route';
import * as one from './[id]/route';
import * as approve from './[id]/approve/route';
import * as reject from './[id]/reject/route';
import * as cancel from './[id]/cancel/route';

const req = (body?: unknown) => ({ url: 'http://x/api', json: async () => body ?? {} }) as unknown as NextRequest;
const ctx = { params: Promise.resolve({ id: 'T1' }) };

const cases: [string, () => Promise<Response>, string][] = [
  ['GET list', () => list.GET(req()), 'view'],
  ['POST create', () => list.POST(req({})), 'create'],
  ['PUT edit', () => one.PUT(req({}), ctx), 'edit'],
  ['DELETE', () => one.DELETE(req(), ctx), 'delete'],
  ['POST approve', () => approve.POST(req(), ctx), 'approve'],
  ['POST reject', () => reject.POST(req(), ctx), 'approve'],
  ['POST cancel', () => cancel.POST(req(), ctx), 'approve'],
];

describe('RBAC endpoint transfer', () => {
  beforeEach(() => { h.calls = []; h.allow = false; vi.clearAllMocks(); });

  it.each(cases)('%s: 403 tanpa izin dan workflow tak dipanggil', async (_name, call, action) => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([['consignment', action]]);
    for (const fn of [wf.approveTransfer, wf.rejectTransfer, wf.cancelTransfer, wf.deleteTransfer, wf.updateTransferDraft, wf.createTransferDraft]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('dengan izin: POST create → { id }, approve → { ok: true }', async () => {
    h.allow = true;
    expect(await (await list.POST(req({ fromLocationId: 'A' }))).json()).toEqual({ id: 'N1' });
    expect(await (await approve.POST(req(), ctx)).json()).toEqual({ ok: true });
    expect(wf.revalidateTransferCaches).toHaveBeenCalledWith({ effect: true });
  });

  it('error bisnis dipetakan ke { error } dengan status dari error', async () => {
    h.allow = true;
    vi.mocked(wf.approveTransfer).mockRejectedValueOnce(new wf.TransferActionError('sudah', 409));
    const res = await approve.POST(req(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'sudah' });
  });
});
