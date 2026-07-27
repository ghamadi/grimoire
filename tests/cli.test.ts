import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { getVersion } from '#src/lib/utils';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

describe('grimoire cli', () => {
  it('prints the package version', async () => {
    const { stdout } = await runCli('--version');

    expect(stdout).toBe(getVersion());
  });
});

/**
 * Runs the CLI from source in a child process, returning trimmed output.
 *
 * `--conditions=grimoire-src` points the `#src/*` alias at ./src/*.ts.
 * Without it the child resolves to ./dist/*.js and silently tests
 * whatever was last built.
 *
 * Rejects if the CLI exits non-zero. The first test that asserts on a failure
 * path should catch the error here and surface its `code` instead.
 */
async function runCli(...args: string[]) {
  const execFileAsync = promisify(execFile);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    '--conditions=grimoire-src',
    cliPath,
    ...args,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim() };
}
