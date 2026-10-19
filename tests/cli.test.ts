import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, inject, it } from 'vitest';
import { getPackageName, getVersion } from '@/lib/utils';
import { tempGitRepo } from '@test-helpers/git-repo';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';

const cliBundlePath = inject('cliBundlePath');

describe('grimoire cli', () => {
  it.each(['-v', '--version'])('prints the package version for %s', async (flag) => {
    const { stdout, code } = await runCli([flag]);

    expect(code).toBe(0);
    expect(stdout).toBe(getVersion());
  });

  // The only test that reaches cli.ts's top-level catch — the in-process suites
  // drive `buildProgram` directly and never import that file.
  it('reports a refusal on stderr and exits non-zero', async () => {
    const { stderr, code } = await runCli(['workspaces', 'remove', 'nope'], { home: await tempRoot() });

    expect(code).toBe(1);
    expect(stderr).toBe('error: no workspace named "nope"');
  });

  it('prints status without escape codes when stdout is piped', async () => {
    const { stdout, code } = await runCli(['status'], { home: await tempRoot(), dropColorEnv: true });

    expect(code).toBe(0);
    expect(stdout).not.toContain('\x1b[');
  });

  it('prints status with no table fitted to a width when stdout is piped', async () => {
    const home = await tempRoot();
    const longSegments = join('a'.repeat(60), 'b'.repeat(60));
    const workspace = join(await tempRoot(), longSegments);

    mkdirSync(workspace, { recursive: true });
    await runCli(['workspaces', 'add', 'deep', workspace], { home });

    const { stdout } = await runCli(['status'], { home });

    expect(stdout.split('\n').some((line) => line.includes(longSegments))).toBe(true);
  });

  it('reports a git that cannot be run as a refusal', async () => {
    const { path: repo } = await tempGitRepo();

    const { stderr, code } = await runCli(['repos', 'add', 'library', repo], {
      home: await tempRoot(),
      envPath: await tempRoot(),
    });

    expect(code).toBe(1);
    expect(stderr).toBe('error: could not run git: repos need it installed and on your PATH');
  });

  it('reports an npm that cannot be run as a refusal', async () => {
    const { stderr, code } = await runCli(['update'], {
      home: await tempRoot(),
      envPath: await tempRoot(),
    });

    expect(code).toBe(1);
    expect(stderr).toBe(
      [
        'checking for the latest release…',
        'error: could not run npm: `grimoire update` needs it installed and on your PATH',
      ].join('\n'),
    );
  });

  it('installs a newer release when the bundle sits inside the npm global root', async () => {
    const newer = `${Number(getVersion().split('.')[0]) + 1}.0.0`;
    const packageDirectory = dirname(dirname(cliBundlePath));
    const { binDirectory, readRecordedArgs } = await createFakeNpm({
      latestVersion: newer,
      globalRoot: dirname(packageDirectory),
    });

    const { stdout, stderr, code } = await runCli(['update'], {
      home: await tempRoot(),
      envPath: binDirectory,
    });

    expect(code).toBe(0);
    expect(stdout).toBe(`updated grimoire ${getVersion()} → ${newer}`);
    expect(stderr).toBe(
      ['checking for the latest release…', `installing grimoire ${newer}…`].join('\n'),
    );
    expect(readRecordedArgs()).toEqual([
      `view ${getPackageName()} version`,
      'root -g',
      `install -g ${getPackageName()}@${newer}`,
    ]);
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
  /** Replaces `$PATH` for the child. Node itself is run by absolute path. */
  envPath?: string;
};

/**
 * Runs the CLI test bundle in a child process, returning trimmed output and the
 * exit code.
 *
 * A non-zero exit resolves like any other run — the code is the thing under
 * test on a failure path, not a reason to reject.
 */
async function runCli(args: string[], options: RunCliOptions = {}) {
  const execFileAsync = promisify(execFile);
  const baseEnv = options.dropColorEnv ? withoutColorEnv(process.env) : process.env;
  const env = {
    ...baseEnv,
    ...(options.home !== undefined && { HOME: options.home }),
    ...(options.envPath !== undefined && { PATH: options.envPath }),
  };

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliBundlePath, ...args], { env });

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

async function createFakeNpm(params: { latestVersion: string; globalRoot: string }) {
  const { latestVersion, globalRoot } = params;
  const binDirectory = await tempRoot();
  const npmPath = join(binDirectory, 'npm');
  const argsPath = join(binDirectory, 'args');
  const script = [
    '#!/bin/sh',
    `echo "$*" >> '${argsPath}'`,
    'case "$1" in',
    `  view) echo '${latestVersion}' ;;`,
    `  root) echo '${globalRoot}' ;;`,
    "  install) echo 'added 1 package in 2s'; echo 'npm warn deprecated something' >&2 ;;",
    'esac',
  ].join('\n');

  writeFileSync(npmPath, `${script}\n`, 'utf8');
  chmodSync(npmPath, 0o755);

  return {
    binDirectory,
    readRecordedArgs: () => readFileSync(argsPath, 'utf8').trim().split('\n'),
  };
}
