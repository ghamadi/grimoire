import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertUsableDirectory } from '#src/lib/directories';
import { DuplicateNameError, PathCollisionError, UnknownNameError } from '#src/lib/errors/index';
import { findGrimoireHomeCollision, findWorkspaceCollision, normalizePath } from '#src/lib/paths';
import type { GrimoireStore, RepoConfig } from '#src/store/index';

export type RepoMode = RepoConfig['mode'];

export { repoModes } from '#src/store/index';

export const DEFAULT_REPO_MODE: RepoMode = 'read-only';

/** A repo entry made whole: config.json holds the name as a key, not a field. */
export type Repo = { name: string } & RepoConfig;

export type RepoWarning = { kind: 'no-git'; path: string };

export type AddRepoInput = {
  name: string;
  path: string;
  mode?: RepoMode;
};

export type RepoAdded = {
  repo: Repo;
  warning: RepoWarning | null;
};

/**
 * Registers a repo, or refuses.
 *
 * The order of the checks is the policy, which is why it lives here in one
 * reviewable place rather than spread across a command handler: a path has to
 * be usable before a name can be argued about.
 */
export function addRepo(store: GrimoireStore, input: AddRepoInput): RepoAdded {
  // Ensure the grimoire home is usable before we do anything else
  const storeConfig = store.loadConfig();

  const path = normalizePath(input.path);
  const mode = input.mode ?? DEFAULT_REPO_MODE;

  assertUsableDirectory(path);

  if (storeConfig.repos[input.name]) {
    throw new DuplicateNameError({ registry: 'repos', name: input.name });
  }

  const collision =
    findGrimoireHomeCollision({ home: store.paths.root, path }) ??
    findWorkspaceCollision({ storeConfig, path });

  if (collision) {
    throw new PathCollisionError({ path, collision });
  }

  // An unversioned repo is still legitimate, so we only emit a warning.
  const warning: RepoWarning | null = isVersionControlled(path) ? null : { kind: 'no-git', path };
  const repoConfig: RepoConfig = { path, mode };

  store.saveConfig({ ...storeConfig, repos: { ...storeConfig.repos, [input.name]: repoConfig } });

  return { repo: { name: input.name, ...repoConfig }, warning };
}

/**
 * Unregisters a repo and returns what was removed, so a caller can echo the
 * path without a second read.
 *
 * Only updates the config.json file.
 * Does not remove skills previously imported from the removed repo.
 */
export function removeRepo(store: GrimoireStore, name: string): Repo {
  const storeConfig = store.loadConfig();
  const repoConfig = storeConfig.repos[name];

  if (!repoConfig) {
    throw new UnknownNameError({ registry: 'repos', name });
  }

  const { [name]: _, ...remainingRepos } = storeConfig.repos;

  store.saveConfig({ ...storeConfig, repos: remainingRepos });

  return { name, ...repoConfig };
}

/**
 * Every registered repo, sorted by name.
 * Does not verify the existence of the repos on disk.
 */
export function listRepos(store: GrimoireStore): Repo[] {
  const config = store.loadConfig();

  return Object.entries(config.repos)
    .map(([name, repoConfig]) => ({ name, ...repoConfig }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/**
 * Checks if a directory is version controlled by Git.
 */
function isVersionControlled(path: string): boolean {
  let current = path;

  while (true) {
    if (statSync(join(current, '.git'), { throwIfNoEntry: false })) {
      return true;
    }

    const parent = dirname(current);

    if (parent === current) {
      return false;
    }

    current = parent;
  }
}
