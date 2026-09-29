import { lstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { Skill } from '#src/domains/skill/index';
import { Workspace } from '#src/domains/workspace/index';
import { CloneDeclinedError, type CloneOccupant, type CloneRefusal } from '#src/lib/errors/index';
import { copyTree } from '#src/lib/fs';
import { relate } from '#src/lib/paths';
import { assertUnreachable } from '#src/lib/utils';

// ----------------------------------------------------------------------------
// RESULT SHAPES
// ----------------------------------------------------------------------------

type CloneSkillUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type CloneSkillUseCaseParams = {
  skillName: string;
  /** Registered names, deduplicated keeping first position. At least one. */
  workspaces: string[];
  /** Record a skill directory already at a destination instead of declining it. */
  adopt?: boolean;
};

export type ClonePair = { skill: string; workspace: string };

export type CloneWritten = ClonePair & {
  /** A symlink into the store was removed to make room for the copy. */
  replacedLink: boolean;
};

export type CloneSkillReport = {
  cloned: CloneWritten[];
  adopted: ClonePair[];
  alreadyCloned: ClonePair[];
  declined: CloneRefusal[];
};

export type CloneSkillUseCase = (params: CloneSkillUseCaseParams) => CloneSkillReport;

// ----------------------------------------------------------------------------
// THE USE CASE
// ----------------------------------------------------------------------------

/**
 * Copies one store skill into named workspaces, recording each copy, and
 * steps over every destination it cannot claim.
 *
 * The skill is verified first, then each named workspace — an unknown name
 * throws before any destination is touched. Each pair is classified by what
 * sits at `<workspace>/<skill>` and by whether a clone record already names
 * it; a run that declined every pair throws rather than returning.
 *
 * Destinations are resolved one at a time, in argument order, rather than in a
 * batch ahead of the loop: there is only one skill, so nothing is gained by
 * splitting the pass, and the report's `declined` group would lose the
 * argument order the design pins for it.
 */
export function createCloneSkillUseCase(
  factoryParams: CloneSkillUseCaseFactoryParams,
): CloneSkillUseCase {
  const { storeManager } = factoryParams;

  return (params: CloneSkillUseCaseParams) => {
    const { skillName, workspaces, adopt = false } = params;

    const skill = Skill.createVerified({
      name: skillName,
      path: storeManager.requireSkillPath(skillName),
    });
    const registeredWorkspaces = [...new Set(workspaces)].map((name) =>
      storeManager.requireRegisteredWorkspace(name),
    );

    const cloned: CloneWritten[] = [];
    const adopted: ClonePair[] = [];
    const alreadyCloned: ClonePair[] = [];
    const declined: CloneRefusal[] = [];

    for (const entry of registeredWorkspaces) {
      const workspace = new Workspace(entry);

      if (!workspace.isReachable()) {
        declined.push({
          kind: 'workspace-unreachable',
          skill: skill.name,
          workspace: entry.name,
          path: entry.path,
        });
        continue;
      }

      const outcome = cloneSkillIntoWorkspace({ skill, workspace, adopt, storeManager });
      const outcomeKind = outcome.kind;

      switch (outcomeKind) {
        case 'cloned':
          cloned.push({
            skill: skill.name,
            workspace: workspace.name,
            replacedLink: outcome.replacedLink,
          });
          break;

        case 'adopted':
          adopted.push({ skill: skill.name, workspace: workspace.name });
          break;

        case 'already-cloned':
          alreadyCloned.push({ skill: skill.name, workspace: workspace.name });
          break;

        case 'declined':
          declined.push(outcome.refusal);
          break;

        default:
          assertUnreachable(outcomeKind);
      }
    }

    if (
      declined.length > 0 &&
      cloned.length === 0 &&
      adopted.length === 0 &&
      alreadyCloned.length === 0
    ) {
      throw new CloneDeclinedError({ refusals: declined });
    }

    return { cloned, adopted, alreadyCloned, declined };
  };
}

// ----------------------------------------------------------------------------
// THE PER-PAIR ENGINE
// ----------------------------------------------------------------------------

type PairOutcome =
  | { kind: 'cloned'; replacedLink: boolean }
  | { kind: 'adopted' }
  | { kind: 'already-cloned' }
  | { kind: 'declined'; refusal: CloneRefusal };

type CloneSkillIntoWorkspaceParams = {
  skill: Skill;
  workspace: Workspace;
  adopt: boolean;
  storeManager: GrimoireStoreManager;
};

/**
 * One destination, decided by what sits at `<workspace>/<skill>`, with the
 * clone record read first.
 *
 * Reading the record before inspecting the destination is what lets a
 * `{ path }` record for a directory the user deleted fall into the "nothing
 * there" branch below and still be recognized as already recorded, so the
 * copy is rewritten without adding a second record.
 */
function cloneSkillIntoWorkspace(params: CloneSkillIntoWorkspaceParams): PairOutcome {
  const { skill, workspace, adopt, storeManager } = params;

  const dest = join(workspace.path, skill.name);
  const recorded = storeManager.findSkillClone({ skill: skill.name, directory: workspace.path });

  const occupied = (occupant: CloneOccupant): PairOutcome => ({
    kind: 'declined',
    refusal: {
      kind: 'occupied',
      skill: skill.name,
      workspace: workspace.name,
      path: dest,
      occupant,
    },
  });

  const write = (replacedLink: boolean): PairOutcome => {
    copyTree({ from: skill.path, to: dest });

    if (!recorded) {
      storeManager.recordClone({ skill: skill.name, workspace: workspace.name });
    }

    return { kind: 'cloned', replacedLink };
  };

  const status = lstatSync(dest, { throwIfNoEntry: false });

  if (!status) {
    return write(false);
  }

  if (status.isSymbolicLink()) {
    if (relate({ candidate: dest, reference: skill.path }) === 'equals') {
      unlinkSync(dest);
      return write(true);
    }

    return occupied({ kind: 'foreign-symlink' });
  }

  // Keep after the symlink check: `isDirectory` is false for a symlink to a
  // directory, so a link into the store would be declined as `not-a-directory`.
  if (!status.isDirectory()) {
    return occupied({ kind: 'not-a-directory' });
  }

  if (recorded) {
    return { kind: 'already-cloned' };
  }

  if (!adopt) {
    return occupied({ kind: 'unrecorded-directory' });
  }

  if (!Skill.isSkillDirectory(dest)) {
    return occupied({ kind: 'not-a-skill' });
  }

  storeManager.recordClone({ skill: skill.name, workspace: workspace.name });

  return { kind: 'adopted' };
}
