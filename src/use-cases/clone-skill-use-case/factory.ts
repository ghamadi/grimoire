import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { GrimoireStoreManager } from '@/domains/grimoire-store/index';
import { Skill } from '@/domains/skill/index';
import { Workspace } from '@/domains/workspace/index';
import {
  CloneDeclinedError,
  type CloneFailure,
  type CloneOccupant,
  type CloneRefusal,
} from '@/lib/errors/index';
import { writeTreeStaged } from '@/lib/fs';
import { relate } from '@/lib/paths';
import { assertUnreachable } from '@/lib/utils';

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
  /** Replace a skill directory at a destination with the store copy. */
  overwrite?: boolean;
};

export type ClonePair = { skill: string; workspace: string };

/** What was removed from the destination to make room for the copy. */
export type CloneReplacedEntry = 'nothing' | 'link' | 'directory';

export type CloneWritten = ClonePair & {
  replaced: CloneReplacedEntry;
  /** Set when the copy is in place but deleting the old entry failed, leaving it partly deleted at `path`. */
  strandedOldEntry?: { path: string; error: Error };
};

export type CloneSkillReport = {
  cloned: CloneWritten[];
  adopted: ClonePair[];
  alreadyCloned: ClonePair[];
  declined: CloneRefusal[];
  failed: CloneFailure[];
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
 * it; a run that declined every pair, and failed none, throws rather than
 * returning. A pair whose write fails is reported in `failed` and the run
 * carries on, so the pairs already written are never left unreported.
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
    const { skillName, workspaces, overwrite = false } = params;

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
    const failed: CloneFailure[] = [];

    for (const entry of registeredWorkspaces) {
      const workspace = new Workspace(entry);

      const access = workspace.getDirectoryAccess();

      if (access !== 'accessible') {
        declined.push({
          kind: access === 'unresolvable' ? 'workspace-unreachable' : 'workspace-unreadable',
          skill: skill.name,
          workspace: entry.name,
          path: entry.path,
        });
        continue;
      }

      const outcome = cloneSkillIntoWorkspace({ skill, workspace, storeManager, overwrite });
      const outcomeKind = outcome.kind;

      switch (outcomeKind) {
        case 'cloned':
          cloned.push({
            skill: skill.name,
            workspace: workspace.name,
            replaced: outcome.replaced,
            ...(outcome.strandedOldEntry && { strandedOldEntry: outcome.strandedOldEntry }),
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

        case 'failed':
          failed.push(outcome.failure);
          break;

        default:
          assertUnreachable(outcomeKind);
      }
    }

    if (
      declined.length > 0 &&
      failed.length === 0 &&
      cloned.length === 0 &&
      adopted.length === 0 &&
      alreadyCloned.length === 0
    ) {
      throw new CloneDeclinedError({ refusals: declined });
    }

    return { cloned, adopted, alreadyCloned, declined, failed };
  };
}

// ----------------------------------------------------------------------------
// THE PER-PAIR ENGINE
// ----------------------------------------------------------------------------

type PairOutcome =
  | { kind: 'cloned'; replaced: CloneReplacedEntry; strandedOldEntry?: CloneWritten['strandedOldEntry'] }
  | { kind: 'adopted' }
  | { kind: 'already-cloned' }
  | { kind: 'declined'; refusal: CloneRefusal }
  | { kind: 'failed'; failure: CloneFailure };

type CloneSkillIntoWorkspaceParams = {
  skill: Skill;
  workspace: Workspace;
  storeManager: GrimoireStoreManager;
  overwrite: boolean;
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
  const { skill, workspace, storeManager, overwrite } = params;

  const dest = join(workspace.path, skill.name);
  const recorded = storeManager.findSkillClone({ skill: skill.name, directory: workspace.path });

  // ------------------------------------------------------------
  // INTERNAL HELPERS
  // ------------------------------------------------------------

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

  const write = (replaced: CloneReplacedEntry): PairOutcome => {
    const result = writeTreeStaged({
      from: skill.path,
      to: dest,
      stagingDirectory: workspace.stagingDirectory,
    });

    if (result.kind === 'failed') {
      return {
        kind: 'failed',
        failure: {
          skill: skill.name,
          workspace: workspace.name,
          path: dest,
          error: result.error,
        },
      };
    }

    if (!recorded) {
      storeManager.recordClone({ skill: skill.name, workspace: workspace.name });
    }

    return {
      kind: 'cloned',
      replaced,
      ...(result.strandedOldEntry && { strandedOldEntry: result.strandedOldEntry }),
    };
  };

  // ------------------------------------------------------------
  // THE MAIN LOGIC
  // ------------------------------------------------------------

  const status = lstatSync(dest, { throwIfNoEntry: false });

  if (!status) {
    return write('nothing');
  }

  if (status.isSymbolicLink()) {
    if (relate({ candidate: dest, reference: skill.path }) === 'equals') {
      return write('link');
    }

    return occupied({ kind: 'foreign-symlink' });
  }

  // Keep after the symlink check: `isDirectory` is false for a symlink to a
  // directory, so a link into the store would be declined as `not-a-directory`.
  if (!status.isDirectory()) {
    return occupied({ kind: 'not-a-directory' });
  }

  if (recorded) {
    return overwrite ? write('directory') : { kind: 'already-cloned' };
  }

  if (!Skill.isSkillDirectory(dest)) {
    return occupied({ kind: 'not-a-skill' });
  }

  if (overwrite) {
    return write('directory');
  }

  storeManager.recordClone({ skill: skill.name, workspace: workspace.name });

  return { kind: 'adopted' };
}
