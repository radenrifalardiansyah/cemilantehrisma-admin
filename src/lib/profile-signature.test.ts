import { describe, expect, it } from 'vitest';
import { isValidSignatureUrl } from './profile-signature';

describe('isValidSignatureUrl', () => {
  it('menerima URL hasil upload Cloudinary', () => {
    expect(isValidSignatureUrl('https://res.cloudinary.com/demo/image/upload/v1/uploads/ttd.png')).toBe(true);
  });
  it('menolak host lain, http, dan skema berbahaya', () => {
    expect(isValidSignatureUrl('http://res.cloudinary.com/demo/a.png')).toBe(false);
    expect(isValidSignatureUrl('https://evil.example.com/a.png')).toBe(false);
    expect(isValidSignatureUrl('https://res.cloudinary.com.evil.com/a.png')).toBe(false);
    expect(isValidSignatureUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isValidSignatureUrl('javascript:alert(1)')).toBe(false);
    expect(isValidSignatureUrl('')).toBe(false);
  });
});
