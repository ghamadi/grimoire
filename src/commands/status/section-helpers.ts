import type { TableCell } from '@/lib/text-table';
import type { DeploymentProblem } from '@/use-cases/report-status-use-case/factory';

/** `unreachable` or `unreadable` when the workspace's content could not be read. */
export function getUnavailableState(
  problems: DeploymentProblem[],
): 'unreachable' | 'unreadable' | undefined {
  if (problems.some(({ kind }) => kind === 'workspace-unreachable')) {
    return 'unreachable';
  }

  return problems.some(({ kind }) => kind === 'workspace-unreadable') ? 'unreadable' : undefined;
}

/** The skills whose recorded clone directory is gone. */
export function getMissingCloneSkills(problems: DeploymentProblem[]): string[] {
  return problems.flatMap((problem) => (problem.kind === 'clone-missing' ? [problem.skill] : []));
}

export function getNotInStoreCell(skill: string): TableCell {
  return { text: `${skill} (not in store)`, style: 'yellow' };
}
