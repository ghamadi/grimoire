import { Command } from 'commander';
import { UpdateDeclinedError } from '@/lib/errors';
import type { NpmClient } from '@/lib/npm';
import { relate } from '@/lib/paths';
import { getPackageName, getVersion } from '@/lib/utils';
import { compareVersions } from '@/lib/versions';

export type UpdateCommandParams = {
  npmClient: NpmClient;
  packageDirectory: string;
};

export function updateCommand(params: UpdateCommandParams): Command {
  const { npmClient, packageDirectory } = params;

  return new Command('update').description('Update grimoire to the latest release').action(() => {
    const packageName = getPackageName();
    const latest = npmClient.getLatestVersion({ packageName });
    const running = getVersion();
    const order = compareVersions(running, latest);

    if (order === 0) {
      console.log(`grimoire ${running} is up to date`);
      return;
    }

    if (order > 0) {
      console.log(`grimoire ${running} is newer than the latest release, ${latest}`);
      return;
    }

    if (!isNpmGlobalInstall({ npmClient, packageDirectory })) {
      throw new UpdateDeclinedError({ latestVersion: latest, packageName });
    }

    npmClient.installGlobal({ packageName, version: latest });
    console.log(`updated grimoire ${running} → ${latest}`);
  });
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function isNpmGlobalInstall(params: { npmClient: NpmClient; packageDirectory: string }): boolean {
  const { npmClient, packageDirectory } = params;

  return relate({ candidate: packageDirectory, reference: npmClient.getGlobalRoot() }) === 'inside';
}
