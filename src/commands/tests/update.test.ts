import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore } from '@/domains/grimoire-store';
import { NpmFailedError, UpdateDeclinedError } from '@/lib/errors';
import type { NpmClient } from '@/lib/npm';
import { getPackageName, getVersion } from '@/lib/utils';
import { buildProgram, type ProgramDependencies } from '@/program';
import { tempRoot } from '@test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

const running = getVersion();
const newer = `${Number(running.split('.')[0]) + 1}.0.0`;
const older = '0.0.0';
const packageName = getPackageName();

describe('update', () => {
  describe('when no newer release exists', () => {
    it('says the running copy is up to date, without asking where npm installs', async () => {
      const npmClient = fakeNpmClient({ latestVersion: running, globalRoot: await tempRoot() });
      const { run } = await newCli({ npmClient, packageDirectory: await tempRoot() });

      const { stdout, stderr } = run('update');

      expect(stdout).toEqual([`grimoire ${running} is up to date`]);
      expect(stderr).toEqual([]);
      expect(npmClient.calls).toEqual([{ name: 'getLatestVersion', params: { packageName } }]);
    });

    it('says when the running copy is newer than the latest release', async () => {
      const npmClient = fakeNpmClient({ latestVersion: older, globalRoot: await tempRoot() });
      const { run } = await newCli({ npmClient, packageDirectory: await tempRoot() });

      const { stdout } = run('update');

      expect(stdout).toEqual([`grimoire ${running} is newer than the latest release, ${older}`]);
      expect(callNames(npmClient)).toEqual(['getLatestVersion']);
    });
  });

  describe('when a newer release exists', () => {
    it('installs it with npm when the running copy is an npm global install', async () => {
      const { globalRoot, packageDirectory } = await npmGlobalLayout();
      const npmClient = fakeNpmClient({ latestVersion: newer, globalRoot });
      const { run } = await newCli({ npmClient, packageDirectory });

      const { stdout } = run('update');

      expect(stdout).toEqual([`updated grimoire ${running} → ${newer}`]);
      expect(npmClient.calls).toEqual([
        { name: 'getLatestVersion', params: { packageName } },
        { name: 'getGlobalRoot', params: undefined },
        { name: 'installGlobal', params: { packageName, version: newer } },
      ]);
    });

    it('counts a package directory reached through a symlink into the global root', async () => {
      const { globalRoot, packageDirectory } = await npmGlobalLayout();
      const linkedPackageDirectory = join(await tempRoot(), 'grimoire');
      symlinkSync(packageDirectory, linkedPackageDirectory);
      const npmClient = fakeNpmClient({ latestVersion: newer, globalRoot });
      const { run } = await newCli({ npmClient, packageDirectory: linkedPackageDirectory });

      run('update');

      expect(callNames(npmClient)).toContain('installGlobal');
    });

    it('declines a copy outside the global root, without installing', async () => {
      const npmClient = fakeNpmClient({ latestVersion: newer, globalRoot: await tempRoot() });
      const { run } = await newCli({ npmClient, packageDirectory: await tempRoot() });

      const error = captureError(() => run('update'));

      expect(error).toBeInstanceOf(UpdateDeclinedError);
      expect(callNames(npmClient)).not.toContain('installGlobal');
    });

    it('declines an `npm link`ed checkout the global root only points to', async () => {
      const globalRoot = await tempRoot();
      const checkout = await tempRoot();
      mkdirSync(join(globalRoot, '@ghamadi'));
      symlinkSync(checkout, join(globalRoot, packageName));
      const npmClient = fakeNpmClient({ latestVersion: newer, globalRoot });
      const { run } = await newCli({ npmClient, packageDirectory: checkout });

      const error = captureError(() => run('update'));

      expect(error).toBeInstanceOf(UpdateDeclinedError);
      expect(callNames(npmClient)).not.toContain('installGlobal');
    });

    it('names the release and the other package managers in the decline', async () => {
      const npmClient = fakeNpmClient({ latestVersion: newer, globalRoot: await tempRoot() });
      const { run } = await newCli({ npmClient, packageDirectory: await tempRoot() });

      const error = captureError(() => run('update'));

      expect(error.message).toBe(
        [
          `grimoire ${newer} is available, but this copy was not installed with \`npm install -g\``,
          '  update it with the package manager that installed it:',
          `    pnpm add -g ${packageName}@latest`,
          `    yarn global add ${packageName}@latest`,
          `    bun add -g ${packageName}@latest`,
        ].join('\n'),
      );
    });

    it('lets a failed install propagate', async () => {
      const { globalRoot, packageDirectory } = await npmGlobalLayout();
      const installError = new NpmFailedError({ args: ['install'], stderr: 'npm error code EACCES' });
      const npmClient = fakeNpmClient({ latestVersion: newer, globalRoot, installError });
      const { run } = await newCli({ npmClient, packageDirectory });

      const error = captureError(() => run('update'));

      expect(error).toBe(installError);
    });
  });

  describe('refusals', () => {
    it('stops at a failed version lookup before anything else', async () => {
      const latestVersionError = new NpmFailedError({
        args: ['view'],
        stderr: 'npm error code ENOTFOUND',
      });
      const npmClient = fakeNpmClient({ latestVersionError, globalRoot: await tempRoot() });
      const { run } = await newCli({ npmClient, packageDirectory: await tempRoot() });

      const error = captureError(() => run('update'));

      expect(error).toBe(latestVersionError);
      expect(callNames(npmClient)).toEqual(['getLatestVersion']);
    });

    it('refuses an argument', async () => {
      const npmClient = fakeNpmClient({ latestVersion: newer, globalRoot: await tempRoot() });
      const { run } = await newCli({ npmClient, packageDirectory: await tempRoot() });

      const error = captureError(() => run('update', newer));

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message).toBe(
        `error: too many arguments for 'update'. Expected 0 arguments but got 1: ${newer}.`,
      );
      expect(npmClient.calls).toEqual([]);
    });
  });
});

type NpmCall = { name: keyof NpmClient; params: unknown };

/** An `NpmClient` that answers from its options and records every call. */
function fakeNpmClient(options: {
  latestVersion?: string;
  latestVersionError?: Error;
  globalRoot: string;
  installError?: Error;
}): NpmClient & { calls: NpmCall[] } {
  const { latestVersion = running, latestVersionError, globalRoot, installError } = options;
  const calls: NpmCall[] = [];

  return {
    calls,
    getLatestVersion: (params) => {
      calls.push({ name: 'getLatestVersion', params });
      if (latestVersionError) {
        throw latestVersionError;
      }
      return latestVersion;
    },
    getGlobalRoot: () => {
      calls.push({ name: 'getGlobalRoot', params: undefined });
      return globalRoot;
    },
    installGlobal: (params) => {
      calls.push({ name: 'installGlobal', params });
      if (installError) {
        throw installError;
      }
    },
  };
}

function callNames(npmClient: { calls: NpmCall[] }): string[] {
  return npmClient.calls.map((call) => call.name);
}

/** A global root holding the package, as `npm install -g` leaves it. */
async function npmGlobalLayout(): Promise<{ globalRoot: string; packageDirectory: string }> {
  const globalRoot = await tempRoot();
  const packageDirectory = join(globalRoot, packageName);
  mkdirSync(packageDirectory, { recursive: true });

  return { globalRoot, packageDirectory };
}

async function newCli(dependencies: ProgramDependencies) {
  const program = silence(buildProgram(new GrimoireStore(await tempRoot()), dependencies));

  function run(...argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      program.parse(argv, { from: 'user' });
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }

    return { stdout, stderr };
  }

  return { run };
}

/**
 * Makes the whole command tree throw instead of exiting, and keeps commander's
 * own error text out of the test runner's output.
 */
function silence(program: Command): Command {
  program.exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });

  for (const subcommand of program.commands) {
    silence(subcommand);
  }

  return program;
}

/** The error a refusal threw, so its exact message can be asserted on. */
function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}
