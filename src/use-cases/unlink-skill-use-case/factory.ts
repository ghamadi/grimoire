import { lstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { GrimoireStoreManager } from '@/domains/grimoire-store/index';
import { UnlinkDeclinedError, type UnlinkRefusal, type UnlinkRefusalReason } from '@/lib/errors/index';
import { getDirectoryAccess } from '@/lib/fs';
import { relate } from '@/lib/paths';
import { assertUnreachable } from '@/lib/utils';

// ----------------------------------------------------------------------------
// RESULT SHAPES
// ----------------------------------------------------------------------------

type UnlinkSkillUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type UnlinkSkillUseCaseParams = {
  skillName: string;
  workspaces: string[] | 'all';
};

export type UnlinkPair = { skill: string; workspace: string };

export type UnlinkSkillReport = {
  unlinked: UnlinkPair[];
  notLinked: UnlinkPair[];
  declined: UnlinkRefusal[];
};

export type UnlinkSkillUseCase = (params: UnlinkSkillUseCaseParams) => UnlinkSkillReport;

// ----------------------------------------------------------------------------
// THE USE CASE
// ----------------------------------------------------------------------------

/**
 * Removes one store skill's links from named workspaces, or from every
 * registered workspace, sorted by name, when `workspaces` is `'all'`.
 *
 * The skill is verified first, then each named workspace — an unknown name
 * throws before any destination is touched. Each pair is classified by what
 * sits at `<workspace>/<skill>`: the link is unlinked, an empty path is
 * `notLinked`, and anything else — including a workspace whose path no longer
 * resolves — is declined. A run that declined every pair throws rather than
 * returning.
 */
export function createUnlinkSkillUseCase(
  factoryParams: UnlinkSkillUseCaseFactoryParams,
): UnlinkSkillUseCase {
  const { storeManager } = factoryParams;

  return (params: UnlinkSkillUseCaseParams) => {
    const { skillName, workspaces } = params;

    const skillPath = storeManager.requireSkillPath(skillName);
    const registeredWorkspaces =
      workspaces === 'all'
        ? storeManager.listRegisteredWorkspaces()
        : [...new Set(workspaces)].map((name) => storeManager.requireRegisteredWorkspace(name));

    const unlinked: UnlinkPair[] = [];
    const notLinked: UnlinkPair[] = [];
    const declined: UnlinkRefusal[] = [];

    for (const workspace of registeredWorkspaces) {
      const outcome = unlinkSkillFromWorkspace({ workspace, skillName, skillPath });
      const outcomeKind = outcome.kind;

      switch (outcomeKind) {
        case 'unlinked':
          unlinked.push({ skill: skillName, workspace: workspace.name });
          break;

        case 'not-linked':
          notLinked.push({ skill: skillName, workspace: workspace.name });
          break;

        case 'declined':
          declined.push(outcome.refusal);
          break;

        default:
          assertUnreachable(outcomeKind);
      }
    }

    // Only throw if we declined everything.
    if (declined.length > 0 && unlinked.length === 0 && notLinked.length === 0) {
      throw new UnlinkDeclinedError({ refusals: declined });
    }

    return { unlinked, notLinked, declined };
  };
}

// ----------------------------------------------------------------------------
// THE PER-PAIR ENGINE
// ----------------------------------------------------------------------------

type PairOutcome =
  { kind: 'unlinked' } | { kind: 'not-linked' } | { kind: 'declined'; refusal: UnlinkRefusal };

type UnlinkSkillFromWorkspaceParams = {
  workspace: { name: string; path: string };
  skillName: string;
  skillPath: string;
};

/**
 * One destination, decided by what sits at `<workspace>/<skill>`.
 *
 * The workspace is checked first: `lstat` of the destination suppresses only
 * ENOENT, so a registered path that is a file raises ENOTDIR, a symlink cycle
 * raises ELOOP, and one that cannot be entered raises EACCES.
 *
 * A workspace that fails that check, whether it does not resolve or cannot be
 * read, is declined, not `not-linked`: the path may be an unmounted volume whose
 * link is intact, so the run cannot report the skill as unlinked from it.
 */
function unlinkSkillFromWorkspace(params: UnlinkSkillFromWorkspaceParams): PairOutcome {
  const { workspace, skillName, skillPath } = params;

  const destinationPath = join(workspace.path, skillName);
  const decline = (reason: UnlinkRefusalReason): PairOutcome => ({
    kind: 'declined',
    refusal: {
      reason,
      skill: skillName,
      workspace: workspace.name,
      path: destinationPath,
    },
  });

  const access = getDirectoryAccess(workspace.path);

  if (access !== 'accessible') {
    return decline(access === 'unresolvable' ? 'workspace-unreachable' : 'workspace-unreadable');
  }

  const status = lstatSync(destinationPath, { throwIfNoEntry: false });

  if (!status) {
    return { kind: 'not-linked' };
  }

  if (status.isSymbolicLink()) {
    if (relate({ candidate: destinationPath, reference: skillPath }) === 'equals') {
      unlinkSync(destinationPath);
      return { kind: 'unlinked' };
    }

    return decline('foreign-symlink');
  }

  // Keep after the symlink check: `isDirectory` is false for a symlink to a
  // directory, so the link would be declined as `not-a-link`.
  if (status.isDirectory()) {
    return decline('directory');
  }

  return decline('not-a-link');
}
