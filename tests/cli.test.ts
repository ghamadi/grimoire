import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { getVersion } from '#src/lib/utils';
import { tempRoot } from '#test-helpers/temp-root';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

describe('grimoire cli', () => {
  it('prints the package version', async () => {
    const { stdout, code } = await runCli(['--version']);

    expect(code).toBe(0);
    expect(stdout).toBe(getVersion());
  });

  // The only test that reaches cli.ts's top-level catch — the in-process suites
  // drive `buildProgram` directly and never import that file.
  it('reports a refusal on stderr and exits non-zero', async () => {
    const { stderr, code } = await runCli(['repo', 'remove', 'nope'], { home: await tempRoot() });

    expect(code).toBe(1);
    expect(stderr).toBe('grimoire: no repo named "nope"');
  });
});

type RunCliOptions = {
  /** Where the child looks for `~/.grimoire`: `os.homedir()` honors `$HOME` on POSIX. */
  home?: string;
};

/**
 * Runs the CLI from source in a child process, returning trimmed output and the
 * exit code.
 *
 * `--conditions=grimoire-src` points the `#src/*` alias at ./src/*.ts.
 * Without it the child resolves to ./dist/*.js and silently tests
 * whatever was last built.
 *
 * A non-zero exit resolves like any other run — the code is the thing under
 * test on a failure path, not a reason to reject.
 */
async function runCli(args: string[], options: RunCliOptions = {}) {
  const execFileAsync = promisify(execFile);
  const env = options.home ? { ...process.env, HOME: options.home } : process.env;

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--conditions=grimoire-src', cliPath, ...args],
      { env },
    );

    return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (error) {
    const { stdout, stderr, code } = error as { stdout: string; stderr: string; code: number };

    return { stdout: stdout.trim(), stderr: stderr.trim(), code };
  }
}
