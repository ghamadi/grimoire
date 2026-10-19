import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
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

  describe('with the real npm', () => {
    it('ignores a project .npmrc in the current directory when asking for the latest version', async () => {
      const registryUrl = await startFakeRegistry({
        latestVersionByPrefix: { user: '0.2.0', project: '9.9.9' },
      });
      const home = await tempRoot();
      const project = await tempRoot();
      writeFileSync(join(home, '.npmrc'), `registry=${registryUrl}/user/\n`, 'utf8');
      writeFileSync(join(project, '.npmrc'), `registry=${registryUrl}/project/\n`, 'utf8');
      writeFileSync(
        join(project, 'package.json'),
        '{ "name": "project", "version": "1.0.0" }\n',
        'utf8',
      );
      isolateNpmConfig({ home });
      changeDirectory(project);

      expect(systemNpmClient.getLatestVersion({ packageName: '@ghamadi/grimoire' })).toBe('0.2.0');
    });
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

/**
 * Leaves npm only the config this test writes: `HOME` points at `home`, and the
 * `npm_config_*` variables are unset. `pnpm test` exports `npm_config_registry`,
 * which outranks every `.npmrc`.
 */
function isolateNpmConfig(params: { home: string }): void {
  const { home } = params;
  vi.stubEnv('HOME', home);

  for (const name of Object.keys(process.env)) {
    if (name.toLowerCase().startsWith('npm_config_')) {
      vi.stubEnv(name, undefined);
    }
  }

  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

function changeDirectory(directory: string): void {
  const previousDirectory = process.cwd();
  process.chdir(directory);
  onTestFinished(() => {
    process.chdir(previousDirectory);
  });
}

/**
 * Serves any package over HTTP on localhost, with the latest version set by the
 * first path segment it is asked under. Resolves to the base URL.
 *
 * The server runs in a worker: `spawnSync` blocks this thread while npm waits
 * for an answer, so a server on this thread could never reply.
 */
async function startFakeRegistry(params: {
  latestVersionByPrefix: Record<string, string>;
}): Promise<string> {
  const { latestVersionByPrefix } = params;
  const source = `
    const { createServer } = require('node:http');
    const { parentPort, workerData } = require('node:worker_threads');

    const server = createServer((request, response) => {
      const [, prefix, encodedName] = request.url.split('/');
      const name = decodeURIComponent(encodedName);
      const version = workerData[prefix];

      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ name, 'dist-tags': { latest: version }, versions: { [version]: { name, version } } }));
    });

    server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
  `;
  const worker = new Worker(source, { eval: true, workerData: latestVersionByPrefix });
  onTestFinished(async () => {
    await worker.terminate();
  });

  const port = await new Promise<number>((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });

  return `http://127.0.0.1:${port}`;
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
