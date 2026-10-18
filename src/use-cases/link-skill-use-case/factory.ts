import { lstatSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { Skill } from '@/domains/skill';
import { Workspace } from '@/domains/workspace';
import { compareContainment } from '@/lib/directory-containment';
import { LinkDeclinedError, type LinkOccupant, type LinkRefusal } from '@/lib/errors';
import { relate } from '@/lib/paths';

// ----------------------------------------------------------------------------
// RESULT SHAPES
// ----------------------------------------------------------------------------

type LinkSkillUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type LinkSkillUseCaseParams = {
  /** Store names. All of them are verified before any of them is linked. */
  skillNames: string[];
  /** Registered names. Omitted or empty means every `autoLink` workspace. */
  workspaces?: string[];
};

/** `replaced` marks a directory that was removed to make room for the link. */
export type LinkWritten = {
  skill: string;
  workspace: string;
  replaced: boolean;
};

export type LinkConfirmed = {
  skill: string;
  workspace: string;
};

export type LinkSkillReport = {
  linked: LinkWritten[];
  alreadyLinked: LinkConfirmed[];
  declined: LinkRefusal[];
};

export type LinkSkillUseCase = (params: LinkSkillUseCaseParams) => LinkSkillReport;

// ----------------------------------------------------------------------------
// THE USE CASE
// ----------------------------------------------------------------------------

/**
 * Symlinks store skills into workspaces, stepping over what it cannot claim.
 *
 * A name that resolves to nothing throws before anything is examined; a fact
 * about the filesystem is declined per pair, and the batch carries on. A run
 * that declined every pair throws rather than returning an empty report, so it
 * exits like every other refusal.
 *
 * Destinations are resolved once for the batch, not per skill: nothing they are
 * checked against depends on the skill, and a per-skill pass would repeat every
 * workspace refusal once per skill.
 */
export function createLinkSkillUseCase(factoryParams: LinkSkillUseCaseFactoryParams): LinkSkillUseCase {
  const { storeManager } = factoryParams;

  return (params: LinkSkillUseCaseParams) => {
    const { skillNames, workspaces: workspaceNames } = params;

    const skills = [...new Set(skillNames)].map((name) =>
      Skill.createVerified({ name, path: storeManager.requireSkillPath(name) }),
    );

    const destinations = resolveDestinations({ storeManager, names: workspaceNames });

    const linked: LinkWritten[] = [];
    const alreadyLinked: LinkConfirmed[] = [];
    const declined: LinkRefusal[] = [...destinations.declined];

    for (const skill of skills) {
      for (const workspace of destinations.resolved) {
        const outcome = linkSkillToWorkspace({ skill, workspace, storeManager });

        switch (outcome.kind) {
          case 'linked':
            linked.push({
              skill: skill.name,
              workspace: workspace.name,
              replaced: outcome.replaced,
            });
            break;

          case 'already-linked':
            alreadyLinked.push({ skill: skill.name, workspace: workspace.name });
            break;

          case 'declined':
            declined.push(outcome.refusal);
            break;
        }
      }
    }

    const linkedCount = linked.length + alreadyLinked.length;

    if (declined.length > 0 && linkedCount === 0) {
      throw new LinkDeclinedError({ refusals: declined });
    }

    return { linked, alreadyLinked, declined };
  };
}

// ----------------------------------------------------------------------------
// DESTINATION RESOLUTION
// ----------------------------------------------------------------------------

type Destinations = {
  resolved: Workspace[];
  declined: LinkRefusal[];
};

/**
 * The workspaces named, or every auto-linking one, that can actually be written
 * into.
 *
 * Names are verified against the state first — an unknown one throws before
 * anything is examined. Registration is not proof of the filesystem: the
 * directory may be gone. That does not end the run; the workspace drops out and
 * the batch proceeds.
 *
 * A missing directory is never created here. `workspaces add` is the one command
 * that creates a segment, and a registration that no longer resolves is
 * `status`'s to report.
 */
function resolveDestinations(query: {
  storeManager: GrimoireStoreManager;
  names?: string[];
}): Destinations {
  const { storeManager, names } = query;

  const uniqueNames = names && [...new Set(names)];

  // Registration only: these paths have not been checked against the filesystem.
  const registeredWorkspaces = uniqueNames
    ? uniqueNames.map((name) => storeManager.requireRegisteredWorkspace(name))
    : storeManager.listRegisteredWorkspaces().filter(({ autoLink }) => autoLink);

  if (registeredWorkspaces.length === 0) {
    return { resolved: [], declined: [] };
  }

  const resolved: Workspace[] = [];
  const declined: LinkRefusal[] = [];

  for (const entry of registeredWorkspaces) {
    const workspace = new Workspace(entry);

    const access = workspace.getDirectoryAccess();

    if (access !== 'accessible') {
      declined.push({
        kind: access === 'unresolvable' ? 'workspace-unreachable' : 'workspace-unreadable',
        workspace: workspace.name,
        path: workspace.path,
      });
      continue;
    }

    resolved.push(workspace);
  }

  return { resolved, declined };
}

// ----------------------------------------------------------------------------
// THE PER-PAIR ENGINE
// ----------------------------------------------------------------------------

type PairOutcome =
  | { kind: 'linked'; replaced: boolean }
  | { kind: 'already-linked' }
  | { kind: 'declined'; refusal: LinkRefusal };

/**
 * Links one skill into one workspace, decided by what sits at the destination.
 *
 * The link's target is the lexical store path rather than a realpath, so `ls -l`
 * reads back the path the user knows their store by.
 */
function linkSkillToWorkspace(params: {
  skill: Skill;
  workspace: Workspace;
  storeManager: GrimoireStoreManager;
}): PairOutcome {
  const { skill, workspace, storeManager } = params;

  const destinationPath = join(workspace.path, skill.name);

  // A destination that is already occupied is declined.
  const occupied = (occupant: LinkOccupant): PairOutcome => ({
    kind: 'declined',
    refusal: {
      kind: 'occupied',
      skill: skill.name,
      workspace: workspace.name,
      path: destinationPath,
      occupant,
    },
  });

  const status = lstatSync(destinationPath, { throwIfNoEntry: false });

  if (!status) {
    symlinkSync(skill.path, destinationPath);
    return { kind: 'linked', replaced: false };
  }

  if (status.isSymbolicLink()) {
    return relate({ candidate: destinationPath, reference: skill.path }) === 'equals'
      ? { kind: 'already-linked' }
      : occupied({ kind: 'foreign-symlink' });
  }

  // Keep after the symlink check: `isDirectory` is false for a symlink, so a
  // link to the store would be declined as `not-a-directory`.
  if (!status.isDirectory()) {
    return occupied({ kind: 'not-a-directory' });
  }

  // Keep before the containment comparison: a clone that has not drifted yet
  // compares as `contained`, and would be swapped for a link.
  if (storeManager.findSkillClone({ skill: skill.name, directory: workspace.path })) {
    return occupied({ kind: 'clone' });
  }

  // Get the containment result of the destination directory against the store's skill directory
  const containment = compareContainment({
    candidate: destinationPath,
    reference: skill.path,
  });

  switch (containment.kind) {
    // If all the destination's content is contained in the store,
    // it's safe to replace it with a link to the store
    case 'contained':
      rmSync(destinationPath, { recursive: true });
      symlinkSync(skill.path, destinationPath);

      return { kind: 'linked', replaced: true };

    // If the destination differs in any way, link is declined
    case 'differs':
      return occupied({ kind: 'differing-directory', entry: containment.entry });

    // If either the destination or the store hold a symlink, link is declined
    case 'unportable':
      return {
        kind: 'declined',
        refusal: {
          kind: 'unportable',
          skill: skill.name,
          workspace: workspace.name,
          path: containment.root,
          entry: containment.entry,
        },
      };
  }
}
