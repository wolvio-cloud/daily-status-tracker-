import { defineConfig } from 'vitest/config';

// Core is pure TypeScript (no bindings), so it runs in plain Node for speed.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
