import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Module-local suites live beside the code they cover, so a test may reach
    // past that module's barrel; cross-cutting suites stay in ./tests.
    include: ['src/**/tests/*.test.ts', 'tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
    globalSetup: ['tests/global-setup.ts'],
  },
});
