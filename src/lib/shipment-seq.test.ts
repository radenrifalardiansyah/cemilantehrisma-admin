import { describe, it, expect } from 'vitest';
import { parseDeliverySeq } from './shipment-seq';

describe('parseDeliverySeq', () => {
  it('kosong -> null', () => { for (const v of [undefined, null, '']) expect(parseDeliverySeq(v)).toBeNull(); });
  it('angka valid', () => { expect(parseDeliverySeq(3)).toBe(3); expect(parseDeliverySeq('12')).toBe(12); expect(parseDeliverySeq(999)).toBe(999); });
  it('tidak valid', () => {
    for (const v of [0, -1, 1.5, 1000, 'abc', '  ', NaN, {}, [], true]) expect(parseDeliverySeq(v)).toBe('invalid');
  });
});
