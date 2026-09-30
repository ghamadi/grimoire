import { unlinkSync } from 'node:fs';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { Workspace } from '#src/domains/workspace/index';
import { UnreadableWorkspaceRemovalError, WorkspaceInUseError } from '#src/lib/errors/index';

type RemoveWorkspaceUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type RemoveWorkspaceUseCaseParams = {
  name: string;
  /** Clear the links still pointing at the workspace, and forget its clone records. */
  hard?: boolean;
  /** Unregister a workspace whose directory cannot be read, instead of refusing. */
  force?: boolean;
};

export type RemoveWorkspaceResult = {
  workspace: Workspace;
  /** Skills whose links into the store were unlinked, by name. */
  clearedLinks: string[];
  /** Skills whose clone records were dropped, by name. `--hard` only. */
  forgottenClones: string[];
  /** Skills whose clone records now carry the path instead of the name, by name. */
  convertedClones: string[];
  /** The directory could not be read, so the links inside it were left in place unseen. */
  linksUnchecked: boolean;
};

export type RemoveWorkspaceUseCase = (params: RemoveWorkspaceUseCaseParams) => RemoveWorkspaceResult;

/**
 * Unregisters a workspace, or refuses while links still point at it — what
 * `grimoire workspaces remove` runs.
 *
 * The directory and everything in it outlive the call. Clearing links is a
 * deletion, so it takes `--hard`; without one, a workspace still holding them is
 * refused rather than left behind as symlinks nothing tracks.
 *
 * A directory that cannot be read is refused too, with or without `--hard`:
 * links that cannot be seen cannot be cleared. `--force` skips the link scan and
 * unregisters anyway, reporting the links as unchecked. It changes nothing for a
 * workspace that can be read, so it can never leave links in one untracked. A
 * path that does not resolve has nothing to scan and always unregisters.
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
    const { name, hard = false, force = false } = params;

    const registered = storeManager.requireRegisteredWorkspace(name);
    const workspace = new Workspace(registered);
    const access = workspace.getDirectoryAccess();

    if (access === 'unreadable' && !force) {
      throw new UnreadableWorkspaceRemovalError({ name, path: registered.path, hard });
    }

    const links = access === 'accessible' ? storeManager.findLinksFromWorkspace(name) : [];

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
      workspace,
      clearedLinks: links.map(({ skill }) => skill),
      forgottenClones: hard ? updatedCloneRecords : [],
      convertedClones: hard ? [] : updatedCloneRecords,
      linksUnchecked: access === 'unreadable',
    };
  };
}
