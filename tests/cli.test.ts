import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { getVersion } from '#src/lib/utils';
import { lockDirectory, runsAsRoot } from '#test-helpers/locked-directory';
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
    const { stderr, code } = await runCli(['workspaces', 'remove', 'nope'], { home: await tempRoot() });

    expect(code).toBe(1);
    expect(stderr).toBe('grimoire: no workspace named "nope"');
  });

  it('prints status without escape codes when stdout is piped', async () => {
    const { stdout, code } = await runCli(['status'], { home: await tempRoot(), dropColorEnv: true });

    expect(code).toBe(0);
    expect(stdout).not.toContain('\x1b[');
  });

  // A raw EACCES stack through the real process was the original report, so this
  // stays even though the command-level tests cover the same logic.
  describe.skipIf(runsAsRoot)('an unreadable workspace', () => {
    it('is reported by status on stdout, exiting 0 with nothing on stderr', async () => {
      const home = await tempRoot();
      const workspace = join(await tempRoot(), 'skills');

      mkdirSync(workspace);
      await runCli(['workspaces', 'add', 'scratch', workspace], { home });
      lockDirectory({ path: workspace });

      const { stdout, stderr, code } = await runCli(['status'], { home });

      expect(code).toBe(0);
      expect(stdout).toContain('cannot be read');
      expect(stderr).toBe('');
    });
  });
});

type RunCliOptions = {
  /** Where the child looks for `~/.grimoire`: `os.homedir()` honors `$HOME` on POSIX. */
  home?: string;
  /** Removes the variables that force or forbid color, so the run tests the child's own stdout. */
  dropColorEnv?: boolean;
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
  const baseEnv = options.dropColorEnv ? withoutColorEnv(process.env) : process.env;
  const env = options.home ? { ...baseEnv, HOME: options.home } : baseEnv;

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

function withoutColorEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const colorVariables = ['FORCE_COLOR', 'NO_COLOR', 'NODE_DISABLE_COLORS'];

  return Object.fromEntries(Object.entries(env).filter(([name]) => !colorVariables.includes(name)));
}
