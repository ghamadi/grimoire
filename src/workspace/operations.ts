import { lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertUsableDirectory } from '#src/lib/directories';
import {
  DuplicateNameError,
  InvalidPathError,
  PathCollisionError,
  UnknownNameError,
  WorkspaceInUseError,
} from '#src/lib/errors/index';
import { isErrnoException } from '#src/lib/fs';
import {
  findGrimoireHomeCollision,
  findRepoCollision,
  normalizePath,
  type Collision,
} from '#src/lib/paths';
import type { CloneRecord, GrimoireStore, State, WorkspaceConfig } from '#src/store/index';
import { findStoreLinks, type StoreLink } from './links.ts';

/** A workspace entry made whole: config.json holds the name as a key, not a field. */
export type Workspace = { name: string } & WorkspaceConfig;

export type AddWorkspaceInput = {
  name: string;
  path: string;
  autoLink?: boolean;
};

export type WorkspaceAdded = {
  workspace: Workspace;
  created: string | null;
};

/** What still points at a workspace, by skill name. */
export type WorkspaceUsage = {
  links: string[];
  clones: string[];
};

export type RemoveWorkspaceInput = {
  name: string;
  hard?: boolean;
};

export type WorkspaceRemoved = {
  workspace: Workspace;
  cleared: WorkspaceUsage;
  /** Clone records rewritten to name the workspace's path, by skill name. */
  converted: string[];
  collision: Collision | null;
};

/**
 * Registers a workspace, or refuses.
 *
 * The path is handled last, inverting `addRepo`'s order: there the check is
 * free, here it can create a directory, and a refused `add` must leave nothing
 * behind.
 */
export function addWorkspace(store: GrimoireStore, input: AddWorkspaceInput): WorkspaceAdded {
  // Ensure the grimoire home is usable before we do anything else
  const storeConfig = store.loadConfig();

  const path = normalizePath(input.path);
  const { autoLink = false, name } = input;

  if (storeConfig.workspaces[name]) {
    throw new DuplicateNameError({ registry: 'workspaces', name: name });
  }

  // A workspace cannot be related to the grimoire home or a repo
  const collision =
    findGrimoireHomeCollision({ home: store.paths.root, path }) ??
    findRepoCollision({ storeConfig, path });

  if (collision) {
    throw new PathCollisionError({ path, collision });
  }

  const created = ensureDirectory(path);
  const workspaceConfig: WorkspaceConfig = { path, autoLink };

  store.saveConfig({
    ...storeConfig,
    workspaces: { ...storeConfig.workspaces, [name]: workspaceConfig },
  });

  return { workspace: { name, ...workspaceConfig }, created };
}

/**
 * Unregisters a workspace, or refuses while links still point at it.
 *
 * Stricter than `removeRepo` because a workspace is a deployment target:
 * forgetting one while its links remain leaves dangling symlinks, and clearing
 * them is a deletion, so it takes `--hard`.
 *
 * Clone records need no such permission. The name they carry stops resolving
 * the moment the workspace is unregistered, so they are rewritten to carry the
 * path instead — the record is what marks a directory as a managed copy, and
 * nothing else on disk does. `--hard` forgets them; a cloned directory is never
 * deleted either way.
 *
 * A path that has become a repo's since it was registered is read as neither:
 * the collision is reported, the directory is left untouched, and the name is
 * surrendered anyway, because unregistering is the documented fix for a
 * collision and a refusal would leave no way to apply it.
 */
export function removeWorkspace(store: GrimoireStore, input: RemoveWorkspaceInput): WorkspaceRemoved {
  const { name, hard = false } = input;

  const storeConfig = store.loadConfig();
  const workspaceConfig = storeConfig.workspaces[name];

  if (!workspaceConfig) {
    throw new UnknownNameError({ registry: 'workspaces', name });
  }

  const state = store.loadState();
  const collision =
    findGrimoireHomeCollision({ home: store.paths.root, path: workspaceConfig.path }) ??
    findRepoCollision({ storeConfig, path: workspaceConfig.path });

  const links = collision
    ? []
    : findStoreLinks({ workspacePath: workspaceConfig.path, storeSkills: store.paths.skills });

  const clones = findCloneRecords({ state, name });

  if (!hard && links.length > 0) {
    throw new WorkspaceInUseError({ name, links: links.map(({ skill }) => skill) });
  }

  clearLinks(links);

  if (clones.length > 0) {
    store.saveState(
      hard
        ? withoutWorkspaceClones({ state, name })
        : withWorkspaceClonesByPath({ state, name, path: workspaceConfig.path }),
    );
  }

  const { [name]: _, ...remainingWorkspaces } = storeConfig.workspaces;

  store.saveConfig({ ...storeConfig, workspaces: remainingWorkspaces });

  return {
    workspace: { name, ...workspaceConfig },
    cleared: { links: links.map(({ skill }) => skill), clones: hard ? clones : [] },
    converted: hard ? [] : clones,
    collision,
  };
}

/**
 * Every registered workspace, sorted by name.
 * Does not verify the existence of the workspaces on disk.
 */
export function listWorkspaces(store: GrimoireStore): Workspace[] {
  const config = store.loadConfig();

  return Object.entries(config.workspaces)
    .map(([name, workspaceConfig]) => ({ name, ...workspaceConfig }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/**
 * The skills recorded as cloned into this workspace by name, sorted.
 *
 * A `{ path }` record keeps resolving after the workspace is unregistered, so
 * only the name-keyed ones are at stake.
 */
function findCloneRecords(query: { state: State; name: string }): string[] {
  return Object.entries(query.state)
    .filter(([, skillState]) =>
      skillState.clones.some((record) => isWorkspaceClone({ record, name: query.name })),
    )
    .map(([skill]) => skill)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The same clones, recorded by path.
 *
 * The path is the workspace's own, so the record keeps naming the directory it
 * always named — only the way it gets there changes, from a config lookup that
 * is about to fail to the answer that lookup would have given.
 */
function withWorkspaceClonesByPath(query: { state: State; name: string; path: string }): State {
  return Object.fromEntries(
    Object.entries(query.state).map(([skill, skillState]) => [
      skill,
      {
        ...skillState,
        clones: skillState.clones.map((record) =>
          isWorkspaceClone({ record, name: query.name }) ? { path: query.path } : record,
        ),
      },
    ]),
  );
}

/** The skill's key stays with an empty array: `clones: []` means "never cloned". */
function withoutWorkspaceClones(query: { state: State; name: string }): State {
  return Object.fromEntries(
    Object.entries(query.state).map(([skill, skillState]) => [
      skill,
      {
        ...skillState,
        clones: skillState.clones.filter((record) => !isWorkspaceClone({ record, name: query.name })),
      },
    ]),
  );
}

function isWorkspaceClone(query: { record: CloneRecord; name: string }): boolean {
  return 'workspace' in query.record && query.record.workspace === query.name;
}

/** The symlink only — whatever it points at in the store stays. */
function clearLinks(links: StoreLink[]): void {
  for (const link of links) {
    unlinkSync(link.path);
  }
}

/**
 * Returns the directory it had to create, or `null` when one was already there.
 *
 * One segment deep, never recursive: `~/.claude` existing while
 * `~/.claude/skills` does not is the case worth smoothing, while a typo in the
 * parent should surface as one rather than materialize a tree.
 */
function ensureDirectory(path: string): string | null {
  if (isOccupied(path)) {
    assertUsableDirectory(path);
    return null;
  }

  try {
    mkdirSync(path);
  } catch (error) {
    // Nothing occupies the path, so what is left is the parent.
    refuseUnusableParent(error, path);
    throw error;
  }

  return path;
}

/**
 * Whether anything holds the path, a dangling symlink included: `statSync`
 * follows one, reports nothing, and leaves `mkdirSync` to fail on the link.
 *
 * `throwIfNoEntry` suppresses ENOENT and nothing else, so a parent that is a
 * file still surfaces here rather than at the `mkdirSync` that never runs.
 */
function isOccupied(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch (error) {
    refuseUnusableParent(error, path);
    throw error;
  }
}

/**
 * Translates the two errnos that mean the parent cannot hold a directory, and
 * returns for anything else: a raw errno is not a GrimoireError, so cli.ts
 * would print a stack trace for what is an ordinary typo.
 */
function refuseUnusableParent(error: unknown, path: string): void {
  if (isErrnoException(error, 'ENOENT')) {
    throw new InvalidPathError({ path: dirname(path), reason: 'missing' });
  }

  if (isErrnoException(error, 'ENOTDIR')) {
    throw new InvalidPathError({ path: dirname(path), reason: 'not-a-directory' });
  }
}
