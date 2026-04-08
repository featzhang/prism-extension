import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use jsdom environment so DOM-touching code (renderPRTitle) works.
    environment: 'jsdom',
    // Global test helpers (describe, it, expect) without explicit import.
    globals: true,
    // Resolve bare module specifiers from the project root.
    root: '.',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['modules/utils.js', 'modules/ci-parser.js', 'modules/storage.js'],
    },
  },
});
