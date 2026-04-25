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

    // Coverage thresholds intentionally set to 0 during refactor.
    // Vitest's per-file gate doesn't match our intent ("70% on lines added,
    // not on files touched"), and pre-existing legacy code in touched files
    // is untested by design (Path Y — refactor issue-by-issue, not wholesale).
    //
    // Coverage is still REPORTED on every test run for visibility, but
    // doesn't fail the build. Re-tighten after Tier A lands and Issue #14+
    // bring broader test surface to legacy code.
    //
    // Tracked: see "Discovered During Refactor" in docs/REFACTOR_PLAN.md
    //   under "Coverage gating strategy"
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

      // Report-only thresholds (see comment block above). Intentionally 0
      // until we revisit the gating strategy post-Tier-A.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
