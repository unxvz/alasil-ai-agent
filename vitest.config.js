import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test discovery
    include: ['**/*.test.js', '**/*.spec.js'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.vitest-cache/**',
      'src.backup-*/**',
    ],

    // Empty for now; populate with global mocks/fixtures as tests grow.
    setupFiles: ['tests/setup.js'],

    // Default reporter — switch to 'verbose' locally if a failure is hard to read.
    reporters: ['default'],

    // Coverage configuration — invoked only with `--coverage` flag, so plain
    // `npm test` is unaffected.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',

      // Source under test. Excludes:
      // - dashboard-html.js (giant static HTML string, not testable)
      // - server.js (process entrypoint)
      // - scripts/ (one-off CLI utilities)
      include: ['src/**/*.js'],
      exclude: [
        'src/dashboard-html.js',
        'src/server.js',
        'tests/**',
        'scripts/**',
        '**/*.config.js',
      ],

      // 70% per-file threshold. Designed for the 16-issue refactor workflow:
      //   npm run test:coverage -- --changed origin/main
      // Scopes the run to files changed vs main, so the threshold gates
      // only the files we touched — not the full pre-existing legacy codebase.
      // Plain `npm run test:coverage` (no --changed) will fail loudly on
      // untested legacy files; that's intentional signal, not noise.
      thresholds: {
        perFile: true,
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
