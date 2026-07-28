import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/**
 * A fresh, empty store root for one test, cleaned up when that test finishes.
 *
 * Every store function takes its root as a parameter, so a filesystem sandbox
 * is a temp directory and nothing else — no `process.env` mutation, and
 * therefore no ordering constraints between tests running in parallel.
 *
 * Lives under `tests/helpers/`, outside the test include glob, so vitest does
 * not collect it as a suite.
 */
export async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'grimoire-'));

  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}
