import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { NpmFailedError, NpmUnavailableError } from '@/lib/errors';
import { systemNpmClient } from '@/lib/npm';
import { tempRoot } from '@test-helpers/temp-root';

describe('systemNpmClient', () => {
  it('returns the latest version npm prints, trimmed', async () => {
    await useFakeNpm({ script: `printf '\\n  0.2.0  \\n'` });

    expect(systemNpmClient.getLatestVersion({ packageName: '@ghamadi/grimoire' })).toBe('0.2.0');
  });

  it('returns the global root npm prints, trimmed', async () => {
    await useFakeNpm({ script: `printf '\\n  /usr/local/lib/node_modules  \\n'` });

    expect(systemNpmClient.getGlobalRoot()).toBe('/usr/local/lib/node_modules');
  });

  it.each([
    {
      call: 'getLatestVersion',
      run: () => systemNpmClient.getLatestVersion({ packageName: '@ghamadi/grimoire' }),
      args: 'view @ghamadi/grimoire version',
    },
    { call: 'getGlobalRoot', run: () => systemNpmClient.getGlobalRoot(), args: 'root -g' },
    {
      call: 'installGlobal',
      run: () => systemNpmClient.installGlobal({ packageName: '@ghamadi/grimoire', version: '0.2.0' }),
      args: 'install -g @ghamadi/grimoire@0.2.0',
    },
  ])('passes npm exactly its args for $call', async ({ run, args }) => {
    const { argsPath } = await useFakeNpm({ script: '' });

    run();

    expect(readRecordedArgs(argsPath)).toBe(args);
  });

  it('throws NpmFailedError with the args and npm output when npm exits non-zero', async () => {
    await useFakeNpm({ script: `echo 'npm error code EACCES' >&2\nexit 243` });

    const error = captureError(() =>
      systemNpmClient.installGlobal({ packageName: '@ghamadi/grimoire', version: '0.2.0' }),
    );

    expect(error).toBeInstanceOf(NpmFailedError);
    expect((error as NpmFailedError).args).toEqual(['install', '-g', '@ghamadi/grimoire@0.2.0']);
    expect((error as NpmFailedError).stderr).toBe('npm error code EACCES\n');
  });

  describe('with npm missing from PATH', () => {
    it.each([
      ['getLatestVersion', () => systemNpmClient.getLatestVersion({ packageName: '@ghamadi/grimoire' })],
      ['getGlobalRoot', () => systemNpmClient.getGlobalRoot()],
      [
        'installGlobal',
        () => systemNpmClient.installGlobal({ packageName: '@ghamadi/grimoire', version: '0.2.0' }),
      ],
    ])('makes %s throw NpmUnavailableError', (_call, run) => {
      stubPath('');

      expect(run).toThrow(NpmUnavailableError);
    });
  });
});

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Puts an `npm` script alone on `PATH`. It records its args to a file, then
 * runs `script`.
 */
async function useFakeNpm(params: { script: string }): Promise<{ argsPath: string }> {
  const { script } = params;
  const binDirectory = await tempRoot();
  const npmPath = join(binDirectory, 'npm');
  const argsPath = join(binDirectory, 'args');

  writeFileSync(npmPath, `#!/bin/sh\necho "$*" > '${argsPath}'\n${script}\n`, 'utf8');
  chmodSync(npmPath, 0o755);
  stubPath(binDirectory);

  return { argsPath };
}

function stubPath(path: string): void {
  vi.stubEnv('PATH', path);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

function readRecordedArgs(argsPath: string): string {
  return readFileSync(argsPath, 'utf8').trim();
}

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected an error');
}
