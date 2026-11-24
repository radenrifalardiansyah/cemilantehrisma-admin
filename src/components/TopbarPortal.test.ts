import { describe, expect, it, vi } from 'vitest';
import { resolveTopbarTarget } from './TopbarPortal';

const el = (name: string) => ({ name }) as unknown as HTMLElement;

describe('resolveTopbarTarget', () => {
  it('tanpa context (undefined): perilaku lama, pakai slot AppShell', () => {
    const shell = el('shell');
    expect(resolveTopbarTarget(undefined, () => shell)).toBe(shell);
  });
  it('dengan context: pakai slot jendela dan tidak menyentuh slot AppShell', () => {
    const win = el('win');
    const lookup = vi.fn(() => el('shell'));
    expect(resolveTopbarTarget(win, lookup)).toBe(win);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('context null (slot jendela belum terpasang): menunggu, tidak jatuh ke slot AppShell', () => {
    const lookup = vi.fn(() => el('shell'));
    expect(resolveTopbarTarget(null, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
});
