import { unlinkSync } from 'node:fs';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { Workspace } from '#src/domains/workspace/index';
import { WorkspaceInUseError } from '#src/lib/errors/index';

type RemoveWorkspaceUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type RemoveWorkspaceUseCaseParams = {
  name: string;
  /** Clear the links still pointing at the workspace, and forget its clone records. */
  hard?: boolean;
};

export type RemoveWorkspaceResult = {
  workspace: Workspace;
  /** Skills whose links into the store were unlinked, by name. */
  clearedLinks: string[];
  /** Skills whose clone records were dropped, by name. `--hard` only. */
  forgottenClones: string[];
  /** Skills whose clone records now carry the path instead of the name, by name. */
  convertedClones: string[];
};

export type RemoveWorkspaceUseCase = (params: RemoveWorkspaceUseCaseParams) => RemoveWorkspaceResult;

/**
 * Unregisters a workspace, or refuses while links still point at it — what
 * `grimoire workspace remove` runs.
 *
 * The directory and everything in it outlive the call. Clearing links is a
 * deletion, so it takes `--hard`; without one, a workspace still holding them is
 * refused rather than left behind as symlinks nothing tracks.
 *
 * Clone records need no such permission. The name they carry stops resolving the
 * moment the workspace is unregistered, so they are rewritten to carry its path
 * instead — the record is what marks a directory as a managed copy, and nothing
 * else on disk does. `--hard` forgets them; a cloned directory is never deleted
 * either way.
 *
 * The registered path needs no vetting here. A path touching the store is
 * illegal, and the store manager refuses to read a registry holding one, so the
 * path this unlinks in has already been proven to be the workspace's own.
 */
export function createRemoveWorkspaceUseCase(
  factoryParams: RemoveWorkspaceUseCaseFactoryParams,
): RemoveWorkspaceUseCase {
  const { storeManager } = factoryParams;

  return (params: RemoveWorkspaceUseCaseParams) => {
    const { name, hard = false } = params;

    const registered = storeManager.requireRegisteredWorkspace(name);
    const links = storeManager.findLinksFromWorkspace(name);

    if (!hard && links.length > 0) {
      throw new WorkspaceInUseError({ name, links: links.map(({ skill }) => skill) });
    }

    // The symlink only: whatever it points at in the store stays.
    for (const link of links) {
      unlinkSync(link.path);
    }

    // Handle clones before dropping the registration.
    // If the operation is interrupted, the records will still resolve,
    // so re-running the command finishes the job.
    const updatedCloneRecords = hard
      ? storeManager.forgetSkillsClonedIntoWorkspace(name)
      : storeManager.recordClonesByPath({ workspace: name, path: registered.path });

    storeManager.unregisterWorkspace(name);

    return {
      workspace: new Workspace(registered),
      clearedLinks: links.map(({ skill }) => skill),
      forgottenClones: hard ? updatedCloneRecords : [],
      convertedClones: hard ? [] : updatedCloneRecords,
    };
  };
}
