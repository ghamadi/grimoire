import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FiledClone,
  GrimoireStoreManager,
  RegisteredWorkspace,
} from '@/domains/grimoire-store/index';
import { getDirectoryAccess, isErrnoException } from '@/lib/fs';
import { normalizePath, relate } from '@/lib/paths';
import { assertUnreachable } from '@/lib/utils';

// ----------------------------------------------------------------------------
// RESULT SHAPES
// ----------------------------------------------------------------------------

type ReportStatusUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type LinkedSkill = {
  /** The store skill the link resolves into. */
  skill: string;
  /** The workspace entry's own name — differs from `skill` only after a rename. */
  entry: string;
};

export type DeploymentProblem =
  | { kind: 'workspace-unreachable' }
  | { kind: 'workspace-unreadable' }
  | { kind: 'dangling-link'; entry: string; target: string }
  | { kind: 'clone-not-in-store'; skill: string }
  | { kind: 'clone-missing'; skill: string; recloneable: boolean };

export type StoreProblem =
  | { kind: 'clone-unregistered-workspace'; skill: string; workspace: string }
  | { kind: 'stray-entry'; entry: string };

export type WorkspaceStatus = {
  name: string;
  path: string;
  autoLink: boolean;
  /** Sorted by skill. Empty when unreachable or unreadable. */
  linked: LinkedSkill[];
  /** Sorted, each once. Unverified when unreachable or unreadable. */
  cloned: string[];
  problems: DeploymentProblem[];
};

export type RecordedPathStatus = {
  /** A `{ path }` record's directory, normalized. */
  path: string;
  cloned: string[];
  problems: DeploymentProblem[];
};

export type StoreStatus = {
  /** The store's `skills/` directory. */
  path: string;
  /** `state.json`, which the hand-edit remedies name. */
  statePath: string;
  skills: string[];
  notDeployed: string[];
  problems: StoreProblem[];
};

export type StatusReport = {
  workspaceStatuses: WorkspaceStatus[];
  recordedPathStatuses: RecordedPathStatus[];
  storeStatus: StoreStatus;
};

export type ReportStatusUseCase = () => StatusReport;

// ----------------------------------------------------------------------------
// THE USE CASE
// ----------------------------------------------------------------------------

type UnregisteredWorkspaceProblem = Extract<StoreProblem, { kind: 'clone-unregistered-workspace' }>;

/** A filed clone whose record resolved to a directory. */
type ResolvedClone = FiledClone & { path: string };

/** Ranks in print order. A kind added to `DeploymentProblem` does not compile until it has one. */
const DEPLOYMENT_PROBLEM_RANK = {
  'workspace-unreachable': 0,
  'workspace-unreadable': 0,
  'dangling-link': 1,
  'clone-not-in-store': 2,
  'clone-missing': 3,
} satisfies Record<DeploymentProblem['kind'], number>;

/**
 * Reports where every skill is deployed — what `grimoire status` runs. Read-only.
 *
 * The report has one status per registered workspace, one per directory named by
 * `{ path }` clone records that no workspace's path equals, and the store's.
 *
 * A clone record belongs to the directory it resolves to, whichever arm names it,
 * so one record can appear in several statuses.
 */
export function createReportStatusUseCase(
  factoryParams: ReportStatusUseCaseFactoryParams,
): ReportStatusUseCase {
  const { storeManager } = factoryParams;

  return () => {
    const registeredWorkspaces = storeManager.listRegisteredWorkspaces();
    const filedClones = storeManager.listFiledClones();
    const storeSkillNames = storeManager.listSkillNames();

    const storeSkillsSet = new Set(storeSkillNames);

    const strayEntryProblems = storeManager
      .listStrayEntryNames()
      .map((entry): StoreProblem => ({ kind: 'stray-entry', entry }));

    const workspaceStatuses = registeredWorkspaces.map((workspace) =>
      getWorkspaceStatus({ workspace, filedClones, storeSkillsSet, storeManager }),
    );

    const recordedPathStatuses = getRecordedPathDirectories({ filedClones, registeredWorkspaces }).map(
      (path) => getRecordedPathStatus({ path, filedClones, storeSkillsSet }),
    );

    const deployedSkills = new Set([
      ...workspaceStatuses.flatMap(({ linked }) => linked.map(({ skill }) => skill)),
      ...workspaceStatuses.flatMap(({ cloned }) => cloned),
      ...recordedPathStatuses.flatMap(({ cloned }) => cloned),
    ]);

    return {
      workspaceStatuses: workspaceStatuses.map(withOrderedProblems),
      recordedPathStatuses: recordedPathStatuses.map(withOrderedProblems),
      storeStatus: {
        path: storeManager.skillsDirectory(),
        statePath: storeManager.statePath(),
        skills: storeSkillNames,
        notDeployed: storeSkillNames.filter((skill) => !deployedSkills.has(skill)),
        problems: [...getUnregisteredWorkspaceProblems(filedClones), ...strayEntryProblems],
      },
    };
  };
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function getWorkspaceStatus(params: {
  workspace: RegisteredWorkspace;
  filedClones: FiledClone[];
  storeSkillsSet: Set<string>;
  storeManager: GrimoireStoreManager;
}): WorkspaceStatus {
  const { workspace, filedClones, storeSkillsSet, storeManager } = params;
  const { name, path, autoLink } = workspace;

  const access = getDirectoryAccess(path);

  if (access !== 'accessible') {
    return {
      name,
      path,
      autoLink,
      linked: [],
      cloned: getSkillNamesFromClones(getResolvedClonesInDirectory({ filedClones, directory: path })),
      problems: [{ kind: access === 'unresolvable' ? 'workspace-unreachable' : 'workspace-unreadable' }],
    };
  }

  const linked = storeManager
    .findLinksFromWorkspace(name)
    .map((link): LinkedSkill => ({ skill: link.storeSkill, entry: link.skill }))
    .sort((a, b) => a.skill.localeCompare(b.skill) || a.entry.localeCompare(b.entry));

  const danglingLinkProblems = storeManager
    .findDanglingLinksFromWorkspace(name)
    .map(({ entry, target }): DeploymentProblem => ({ kind: 'dangling-link', entry, target }));

  const { cloned, problems: cloneProblems } = classifyClones({
    filedClones,
    directory: path,
    storeSkillsSet,
    isWorkspaceBlock: true,
  });

  return {
    name,
    path,
    autoLink,
    linked,
    cloned,
    problems: [...danglingLinkProblems, ...cloneProblems],
  };
}

function getRecordedPathStatus(params: {
  path: string;
  filedClones: FiledClone[];
  storeSkillsSet: Set<string>;
}): RecordedPathStatus {
  const { path, filedClones, storeSkillsSet } = params;

  return {
    path,
    ...classifyClones({ filedClones, directory: path, storeSkillsSet, isWorkspaceBlock: false }),
  };
}

/**
 * Splits the clones in `directory` into those whose copy is there (`cloned`) and the
 * problems with the rest. A skill is missing exactly when it is not `cloned`.
 */
function classifyClones(params: {
  filedClones: FiledClone[];
  directory: string;
  storeSkillsSet: Set<string>;
  isWorkspaceBlock: boolean;
}): { cloned: string[]; problems: DeploymentProblem[] } {
  const { filedClones, directory, storeSkillsSet, isWorkspaceBlock } = params;
  const resolvedClones = getResolvedClonesInDirectory({ filedClones, directory });
  const cloned = getSkillNamesFromClones(resolvedClones.filter((clone) => isPlainDirectory(clone.path)));
  const presentSkillNames = new Set(cloned);

  const problems = getSkillNamesFromClones(resolvedClones).flatMap((skill): DeploymentProblem[] => {
    if (!presentSkillNames.has(skill)) {
      return [
        { kind: 'clone-missing', skill, recloneable: isWorkspaceBlock && storeSkillsSet.has(skill) },
      ];
    }

    return storeSkillsSet.has(skill) ? [] : [{ kind: 'clone-not-in-store', skill }];
  });

  return { cloned, problems };
}

/** One problem per distinct (skill, workspace) record naming a workspace that is not registered. */
function getUnregisteredWorkspaceProblems(filedClones: FiledClone[]): UnregisteredWorkspaceProblem[] {
  const problems = filedClones.flatMap(({ skill, record, path }): UnregisteredWorkspaceProblem[] =>
    path === undefined && 'workspace' in record
      ? [{ kind: 'clone-unregistered-workspace', skill, workspace: record.workspace }]
      : [],
  );

  return problems
    .sort((a, b) => a.skill.localeCompare(b.skill) || a.workspace.localeCompare(b.workspace))
    .filter((problem, index) => {
      const previousProblem = problems[index - 1];

      return !(
        previousProblem?.skill === problem.skill && previousProblem.workspace === problem.workspace
      );
    });
}

/**
 * The directories `{ path }` records name that no registered workspace's path equals,
 * sorted, one per canonical directory: the smallest spelling stands for the rest.
 */
function getRecordedPathDirectories(params: {
  filedClones: FiledClone[];
  registeredWorkspaces: RegisteredWorkspace[];
}): string[] {
  const { filedClones, registeredWorkspaces } = params;

  const recordedDirectories = filedClones
    .flatMap(({ record }) => ('path' in record ? [normalizePath(record.path)] : []))
    .filter(
      (directory) =>
        !registeredWorkspaces.some(
          ({ path }) => relate({ candidate: directory, reference: path }) === 'equals',
        ),
    )
    .sort((a, b) => a.localeCompare(b));

  return recordedDirectories.filter(
    (directory, index) =>
      !recordedDirectories
        .slice(0, index)
        .some(
          (earlierDirectory) =>
            relate({ candidate: directory, reference: earlierDirectory }) === 'equals',
        ),
  );
}

/** The clones that resolve to `directory`, compared the way `findSkillClone` does. */
function getResolvedClonesInDirectory(params: {
  filedClones: FiledClone[];
  directory: string;
}): ResolvedClone[] {
  const { filedClones, directory } = params;

  return filedClones.filter(
    (clone): clone is ResolvedClone =>
      clone.path !== undefined &&
      relate({ candidate: clone.path, reference: join(directory, clone.skill) }) === 'equals',
  );
}

/** `lstat`, so a symlink at `path` is not a clone. */
function isPlainDirectory(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch (error) {
    if (
      isErrnoException(error, 'ENOTDIR') ||
      isErrnoException(error, 'ELOOP') ||
      isErrnoException(error, 'EACCES') ||
      isErrnoException(error, 'EPERM')
    ) {
      return false;
    }

    throw error;
  }
}

function getSkillNamesFromClones(clones: FiledClone[]): string[] {
  return [...new Set(clones.map(({ skill }) => skill))].sort((a, b) => a.localeCompare(b));
}

function withOrderedProblems<Block extends { problems: DeploymentProblem[] }>(block: Block): Block {
  return {
    ...block,
    problems: [...block.problems].sort(
      (a, b) =>
        DEPLOYMENT_PROBLEM_RANK[a.kind] - DEPLOYMENT_PROBLEM_RANK[b.kind] ||
        getProblemSortName(a).localeCompare(getProblemSortName(b)),
    ),
  };
}

function getProblemSortName(problem: DeploymentProblem): string {
  switch (problem.kind) {
    case 'dangling-link':
      return problem.entry;

    case 'clone-not-in-store':
    case 'clone-missing':
      return problem.skill;

    case 'workspace-unreachable':
    case 'workspace-unreadable':
      return '';

    default:
      return assertUnreachable(problem);
  }
}
