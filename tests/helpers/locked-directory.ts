import { chmodSync } from 'node:fs';
import { onTestFinished } from 'vitest';

/**
 * Root ignores permission bits, so a test that locks a directory would pass
 * vacuously. Use with `describe.skipIf(runsAsRoot)`.
 */
export const runsAsRoot: boolean = process.getuid?.() === 0;

/**
 * Sets `path`'s mode for one test, restoring `0o755` when that test finishes.
 *
 * The restore has to run before `tempRoot`'s `rm`, or cleanup fails with
 * EACCES. Vitest runs `onTestFinished` callbacks in reverse registration
 * order, and `tempRoot` registers first.
 */
export function lockDirectory(params: { path: string; mode?: number }): void {
  const { path, mode = 0o000 } = params;

  chmodSync(path, mode);

  onTestFinished(() => {
    chmodSync(path, 0o755);
  });
}
