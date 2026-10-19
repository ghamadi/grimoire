import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { NpmFailedError, NpmUnavailableError } from '@/lib/errors';
import { isErrnoException } from '@/lib/fs';

/**
 * The npm calls `update` makes. Every call throws `NpmUnavailableError` when npm
 * cannot be spawned, and `NpmFailedError` when it exits non-zero.
 */
export type NpmClient = {
  getLatestVersion: (params: { packageName: string }) => string;
  getGlobalRoot: () => string;
  installGlobal: (params: { packageName: string; version: string }) => void;
};

export const systemNpmClient: NpmClient = {
  getLatestVersion: ({ packageName }) => runNpm({ args: ['view', packageName, 'version'] }),
  getGlobalRoot: () => runNpm({ args: ['root', '-g'] }),
  installGlobal: ({ packageName, version }) => {
    runNpm({ args: ['install', '-g', `${packageName}@${version}`] });
  },
};

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function runNpm(params: { args: string[] }): string {
  const { args } = params;
  const result = spawnSync('npm', args, {
    // Without it, `npm view` reads the registry from a `.npmrc` in the user's cwd, which `install -g` ignores.
    cwd: homedir(),
    encoding: 'utf8',
    maxBuffer: Infinity,
  });

  if (result.error) {
    throw isErrnoException(result.error, 'ENOENT') ? new NpmUnavailableError() : result.error;
  }

  if (result.status !== 0) {
    throw new NpmFailedError({ args, stderr: result.stderr });
  }

  return result.stdout.trim();
}
