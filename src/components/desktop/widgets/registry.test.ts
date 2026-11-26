import { describe, expect, it } from 'vitest';
import { WIDGET_SPECS } from '@/lib/widgets';
import { WIDGET_REGISTRY, getWidgetDefinition, listWidgetDefinitions, widgetAllowed, type WidgetDefinition } from './registry';

describe('registry widget', () => {
  it('kunci registry sama persis dengan WIDGET_SPECS (server dan klien tidak boleh berbeda)', () => {
    expect(Object.keys(WIDGET_REGISTRY).sort()).toEqual(Object.keys(WIDGET_SPECS).sort());
  });
  it('definisi mewarisi ukuran/config/izin dari spec dan punya label, ikon, komponen', () => {
    for (const d of listWidgetDefinitions()) {
      const s = WIDGET_SPECS[d.type];
      expect(d.defaultSize).toBe(s.defaultSize);
      expect(d.allowedSizes).toEqual(s.allowedSizes);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.icon).toBeTruthy();
      expect(typeof d.Component).toBe('function');
      expect(d.sanitizeConfig(undefined)).toEqual(s.strictConfig(undefined));
      expect(d.sanitizeConfig({ __proto__: null, zzz: 1 })).toEqual(s.cleanConfig({}));
    }
  });
  it('getWidgetDefinition: tipe dikenal; tipe tak dikenal dan nama prototipe undefined', () => {
    expect(getWidgetDefinition('clock')?.label).toBe('Jam & tanggal');
    expect(getWidgetDefinition('note')?.label).toBe('Catatan tempel');
    expect(getWidgetDefinition('nope')).toBeUndefined();
    expect(getWidgetDefinition('toString')).toBeUndefined();
  });
  it('widgetAllowed: tanpa izin dibutuhkan selalu boleh; dengan izin mengikuti can()', () => {
    const base = WIDGET_REGISTRY.clock;
    expect(widgetAllowed(base, () => false)).toBe(true);
    const guarded: WidgetDefinition = { ...base, permission: { feature: 'dashboard', action: 'view' } };
    expect(widgetAllowed(guarded, (f, a) => f === 'dashboard' && a === 'view')).toBe(true);
    expect(widgetAllowed(guarded, () => false)).toBe(false);
  });
});
