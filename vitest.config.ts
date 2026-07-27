import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests run through Vite's SSR pipeline, so the condition that points `#src/*`
  // at ./src/*.ts belongs here. Plain `resolve.conditions` is client-only — it is
  // silently ignored, and the alias falls through to the ./dist/*.js default,
  // testing whatever stale build happens to be on disk.
  ssr: {
    resolve: {
      conditions: ['grimoire-src'],
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
