import { join } from 'node:path';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { Repo } from '@/domains/repo';
import { Skill } from '@/domains/skill';
import {
  ExportDeclinedError,
  InvalidPathError,
  type ExportFailure,
  type ExportRefusal,
} from '@/lib/errors';
import { tryStatSync, writeTreeStaged } from '@/lib/fs';
import { hasUncommittedChanges, isInsideGitWorkTree } from '@/lib/git';
import { assertUnreachable } from '@/lib/utils';

// ----------------------------------------------------------------------------
// RESULT SHAPES
// ----------------------------------------------------------------------------

type ExportSkillsUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type ExportSkillsUseCaseParams = {
  /** Store names, deduplicated keeping first position. */
  skillNames: string[];
  /** Registered names, deduplicated keeping first position. */
  repoNames: string[];
  /** Skip the git check: replace whatever is at the destination. */
  force?: boolean;
};

export type ExportWritten = {
  skill: string;
  repo: string;
  /** Set when the copy is in place but deleting the old entry failed, leaving it partly deleted at `path`. */
  strandedOldEntry?: { path: string; error: Error };
};

export type ExportSkillsReport = {
  exported: ExportWritten[];
  declined: ExportRefusal[];
  failed: ExportFailure[];
};

export type ExportSkillsUseCase = (params: ExportSkillsUseCaseParams) => ExportSkillsReport;

// ----------------------------------------------------------------------------
// THE USE CASE
// ----------------------------------------------------------------------------

/**
 * Copies store skills into registered repos, replacing what is there, and
 * steps over every destination git reports as uncommitted.
 *
 * Every skill name, every skill's portability, every repo name, and every repo
 * directory are checked in that order, and any of them throws before a
 * destination is touched. A run that declined every write, and failed none,
 * throws rather than returning. A write that fails is reported in `failed` and
 * the run carries on, so the writes already made are never left unreported.
 */
export function createExportSkillsUseCase(
  factoryParams: ExportSkillsUseCaseFactoryParams,
): ExportSkillsUseCase {
  const { storeManager } = factoryParams;

  return (params: ExportSkillsUseCaseParams) => {
    const { skillNames, repoNames, force = false } = params;

    const skills = requireExportableSkills({ storeManager, skillNames });
    const repos = [...new Set(repoNames)].map(
      (name) => new Repo(storeManager.requireRegisteredRepo(name)),
    );

    for (const repo of repos) {
      requireUsableWorkTree(repo);
    }

    const exported: ExportWritten[] = [];
    const declined: ExportRefusal[] = [];
    const failed: ExportFailure[] = [];

    for (const skill of skills) {
      for (const repo of repos) {
        const outcome = exportSkillIntoRepo({ skill, repo, force });
        const outcomeKind = outcome.kind;

        switch (outcomeKind) {
          case 'exported':
            exported.push({
              skill: skill.name,
              repo: repo.name,
              ...(outcome.strandedOldEntry && { strandedOldEntry: outcome.strandedOldEntry }),
            });
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
    }

    if (declined.length > 0 && failed.length === 0 && exported.length === 0) {
      throw new ExportDeclinedError({ refusals: declined });
    }

    return { exported, declined, failed };
  };
}

/**
 * @throws EntityNotFoundError if a name is not in the store.
 * @throws UnportableSkillError if a skill cannot be exported.
 */
export function requireExportableSkills(params: {
  storeManager: GrimoireStoreManager;
  skillNames: string[];
}): Skill[] {
  const { storeManager, skillNames } = params;

  // Two `map` passes intentionally. Verifying all skill paths happens
  // before validating the skills themselves
  const skillPaths = [...new Set(skillNames)].map((name) => ({
    name,
    path: storeManager.requireSkillPath(name),
  }));

  return skillPaths.map((skillPath) => Skill.createVerified(skillPath));
}

/**
 * @throws InvalidPathError if the repo's path is not an existing directory inside a git work tree.
 * @throws GitUnavailableError if git cannot be spawned.
 */
function requireUsableWorkTree(repo: Repo): void {
  const { path } = repo;

  // Stat before asking git: git answers "not inside a work tree" for a missing
  // path too, which sends the reader looking in the wrong place.
  const status = tryStatSync(path);

  if (!status) {
    throw new InvalidPathError({ path, reason: 'missing' });
  }

  if (!status.isDirectory()) {
    throw new InvalidPathError({ path, reason: 'not-a-directory' });
  }

  if (!isInsideGitWorkTree({ directory: path })) {
    throw new InvalidPathError({ path, reason: 'not-in-git-work-tree' });
  }
}

// ----------------------------------------------------------------------------
// THE PER-SKILL ENGINE
// ----------------------------------------------------------------------------

type SkillOutcome =
  | { kind: 'exported'; strandedOldEntry?: ExportWritten['strandedOldEntry'] }
  | { kind: 'declined'; refusal: ExportRefusal }
  | { kind: 'failed'; failure: ExportFailure };

type ExportSkillIntoRepoParams = {
  skill: Skill;
  repo: Repo;
  force: boolean;
};

function exportSkillIntoRepo(params: ExportSkillIntoRepoParams): SkillOutcome {
  const { skill, repo, force } = params;

  const dest = join(repo.path, skill.name);

  if (!force && hasUncommittedChanges({ directory: repo.path, entry: skill.name })) {
    return { kind: 'declined', refusal: { skill: skill.name, repo: repo.name, path: dest } };
  }

  const result = writeTreeStaged({
    from: skill.path,
    to: dest,
    stagingDirectory: repo.stagingDirectory,
  });

  if (result.kind === 'failed') {
    return {
      kind: 'failed',
      failure: { skill: skill.name, repo: repo.name, path: dest, error: result.error },
    };
  }

  return {
    kind: 'exported',
    ...(result.strandedOldEntry && { strandedOldEntry: result.strandedOldEntry }),
  };
}
