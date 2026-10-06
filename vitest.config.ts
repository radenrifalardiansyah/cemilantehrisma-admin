import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Tes unit untuk logika murni (tanpa database) — `npm test`. Alias `@` sama dengan tsconfig.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node' },
});
