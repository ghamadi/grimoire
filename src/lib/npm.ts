import { spawnSync } from 'node:child_process';
import { NpmFailedError, NpmUnavailableError } from '@/lib/errors';
import { isErrnoException } from '@/lib/fs';

/**
 * The npm calls `update` makes. Every call throws `NpmUnavailableError` when npm
 * cannot be spawned, and `NpmFailedError` when it exits non-zero.
 */
export type NpmClient = {
  /** `npm view <packageName> version`, trimmed. */
  getLatestVersion: (params: { packageName: string }) => string;
  /** `npm root -g`, trimmed. */
  getGlobalRoot: () => string;
  /** `npm install -g <packageName>@<version>`, output captured. */
  installGlobal: (params: { packageName: string; version: string }) => void;
};

/** Runs the npm found on `PATH`. */
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
  const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: Infinity });

  if (result.error) {
    throw isErrnoException(result.error, 'ENOENT') ? new NpmUnavailableError() : result.error;
  }

  if (result.status !== 0) {
    throw new NpmFailedError({ args, stderr: result.stderr });
  }

  return result.stdout.trim();
}
