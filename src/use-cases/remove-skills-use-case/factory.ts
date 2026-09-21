import { unlinkSync } from 'node:fs';
import {
  cloneTrashLabel,
  type GrimoireStoreManager,
  type RegisteredWorkspace,
} from '#src/domains/grimoire-store/index';
import { WorkspaceUnreadableError } from '#src/lib/errors/index';
import { isResolvableDirectory } from '#src/lib/fs';

// ----------------------------------------------------------------------------
// RESULT SHAPES
// ----------------------------------------------------------------------------

type RemoveSkillsUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
  /** Injected so a test can pin the trash bin's name. */
  now?: () => Date;
};

export type RemoveSkillsUseCaseParams = {
  skillNames: string[];
  /** Trash the cloned directories and forget their records. */
  removeClones?: boolean;
};

export type ClearedLink = {
  skill: string;
  workspace: string;
  /**
   * What the link is named in the workspace, when it differs from the skill.
   * This is only possible if the user renames the workspace's skill after linking.
   */
  filedAs?: string;
};

export type RemovedSkill = {
  skill: string;
  /** `<store>/.trash/<skill>-<timestamp>`. */
  binPath: string;
  clearedLinks: ClearedLink[];
  /** Clones trashed, by origin. `--remove-clones` only. */
  removedClones: string[];
  /** Clones left where they are, by origin. */
  keptClones: string[];
};

export type RemoveSkillsUseCase = (params: RemoveSkillsUseCaseParams) => RemovedSkill[];

// ----------------------------------------------------------------------------
// THE USE CASE
// ----------------------------------------------------------------------------

/**
 * Clears every link into a store skill, then moves the store copy into the trash.
 *
 * Clones are kept by default: the record is dropped and the directories trashed
 * only under `removeClones`.
 */
export function createRemoveSkillsUseCase(
  factoryParams: RemoveSkillsUseCaseFactoryParams,
): RemoveSkillsUseCase {
  const { storeManager, now = () => new Date() } = factoryParams;

  return (params: RemoveSkillsUseCaseParams) => {
    const shouldRemoveClones = params.removeClones ?? false;
    const skillNames = [...new Set(params.skillNames)];

    // Ensure all the skills exist
    skillNames.forEach((name) => storeManager.requireSkillPath(name));

    // Ensure the registered workspaces are still resolvable
    const workspaces = storeManager.listRegisteredWorkspaces();
    assertWorkspacesReadable(workspaces);

    const linksFromWorkspacesInventory = workspaces.flatMap((workspace) =>
      storeManager
        .findLinksFromWorkspace(workspace.name)
        .map((link) => ({ workspace: workspace.name, link })),
    );

    const at = now();

    return skillNames.map((name) => {
      const clearedLinks = linksFromWorkspacesInventory
        .filter(({ link }) => link.storeSkill === name)
        .map(({ workspace, link }): ClearedLink => {
          unlinkSync(link.path);

          return {
            workspace,
            skill: name,
            filedAs: link.skill === name ? undefined : link.skill,
          };
        });

      const clones = storeManager.listSkillClones(name);
      const clonesToRemove = shouldRemoveClones ? [...clones] : [];

      const trashedClones = clonesToRemove.map(({ path, record }) => ({
        path,
        label: cloneTrashLabel(record),
      }));

      const binPath = storeManager.trashSkill({ name, clones: trashedClones, at });

      if (shouldRemoveClones) {
        storeManager.forgetSkill(name);
      }

      const removedClonesOriginsSet = new Set(clonesToRemove.map(({ origin }) => origin));
      const keptClonesOrigins = clones
        .filter(({ origin }) => !removedClonesOriginsSet.has(origin))
        .map(({ origin }) => origin);

      return {
        skill: name,
        binPath,
        clearedLinks,
        keptClones: keptClonesOrigins,
        removedClones: [...removedClonesOriginsSet],
      };
    });
  };
}

/**
 * @throws WorkspaceUnreadableError naming every registration whose path is not
 * a directory to read links out of.
 */
function assertWorkspacesReadable(workspaces: RegisteredWorkspace[]): void {
  const unreadable = workspaces.filter(({ path }) => !isResolvableDirectory(path));

  if (unreadable.length > 0) {
    throw new WorkspaceUnreadableError({
      workspaces: unreadable.map(({ name, path }) => ({ name, path })),
    });
  }
}
