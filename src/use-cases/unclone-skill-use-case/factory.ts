import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { Workspace } from '#src/domains/workspace/index';
import { normalizePath } from '#src/lib/paths';

// ----------------------------------------------------------------------------
// RESULT SHAPES
// ----------------------------------------------------------------------------

type UncloneSkillUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type UncloneSkillUseCaseParams = {
  skillName: string;
  /** Workspace names where `Workspace.isValidName`, else paths. Deduplicated keeping first position. At least one. */
  targets: string[];
};

/** `target` is the workspace name as given, or the path normalized. */
export type UnclonePair = { skill: string; target: string };

export type UncloneSkillReport = { uncloned: UnclonePair[]; notCloned: UnclonePair[] };

export type UncloneSkillUseCase = (params: UncloneSkillUseCaseParams) => UncloneSkillReport;

// ----------------------------------------------------------------------------
// THE USE CASE
// ----------------------------------------------------------------------------

/** A target resolved to the directory its record must name. */
type UncloneTarget = { target: string; directory: string };

/**
 * Drops a skill's clone records for the named workspaces and paths.
 *
 * Two passes: every target is parsed and resolved first — an unregistered
 * workspace name throws before any record is dropped — then each is matched
 * and forgotten in argument order. A target is either uncloned or
 * `notCloned`; neither refuses.
 *
 * The store is never consulted, so records whose store skill is gone can still
 * be cleared, and no cloned directory is read or removed.
 */
export function createUncloneSkillUseCase(
  factoryParams: UncloneSkillUseCaseFactoryParams,
): UncloneSkillUseCase {
  const { storeManager } = factoryParams;

  return (params: UncloneSkillUseCaseParams) => {
    const { skillName, targets } = params;

    const parsedTargets = [
      ...new Set(targets.map((value) => (Workspace.isValidName(value) ? value : normalizePath(value)))),
    ];
    const resolvedTargets = parsedTargets.map((target): UncloneTarget => ({
      target,
      directory: Workspace.isValidName(target)
        ? storeManager.requireRegisteredWorkspace(target).path
        : target,
    }));

    const uncloned: UnclonePair[] = [];
    const notCloned: UnclonePair[] = [];

    for (const { target, directory } of resolvedTargets) {
      const clone = storeManager.findSkillClone({ skill: skillName, directory });

      if (clone) {
        storeManager.forgetClone({ skill: skillName, record: clone.record });
        uncloned.push({ skill: skillName, target });
      } else {
        notCloned.push({ skill: skillName, target });
      }
    }

    return { uncloned, notCloned };
  };
}
