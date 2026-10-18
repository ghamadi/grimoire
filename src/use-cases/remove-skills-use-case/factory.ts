import { unlinkSync } from 'node:fs';
import type { GrimoireStoreManager, RegisteredWorkspace } from '@/domains/grimoire-store';
import { WorkspaceUnreadableError } from '@/lib/errors';
import { getDirectoryAccess } from '@/lib/fs';

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
  /** Forget the skill's clone records. The cloned directories are never touched. */
  forgetClones?: boolean;
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
  /** Clone records forgotten, by origin. `--forget-clones` only. */
  forgottenClones: string[];
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
 * Cloned directories are never touched. Their records are dropped only under
 * `forgetClones`; otherwise they are kept.
 */
export function createRemoveSkillsUseCase(
  factoryParams: RemoveSkillsUseCaseFactoryParams,
): RemoveSkillsUseCase {
  const { storeManager, now = () => new Date() } = factoryParams;

  return (params: RemoveSkillsUseCaseParams) => {
    const shouldForgetClones = params.forgetClones ?? false;
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

      const clones = storeManager.listSkillClones(name).map(({ origin }) => origin);
      const binPath = storeManager.trashSkill({ name, at });

      if (shouldForgetClones) {
        storeManager.forgetSkill(name);
      }

      return {
        skill: name,
        binPath,
        clearedLinks,
        forgottenClones: shouldForgetClones ? clones : [],
        keptClones: shouldForgetClones ? [] : clones,
      };
    });
  };
}

/**
 * @throws WorkspaceUnreadableError naming every registration whose path is not
 * a directory to read links out of.
 */
function assertWorkspacesReadable(workspaces: RegisteredWorkspace[]): void {
  const unreadable = workspaces.flatMap(({ name, path }) => {
    const access = getDirectoryAccess(path);

    return access === 'accessible' ? [] : [{ name, path, access }];
  });

  if (unreadable.length > 0) {
    throw new WorkspaceUnreadableError({ workspaces: unreadable });
  }
}
