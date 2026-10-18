import {
  getMissingCloneSkills,
  getNotInStoreCell,
  getUnavailableState,
} from '@/commands/status/helpers/section-helpers';
import { formatSectionTitle } from '@/commands/status/helpers/section-title';
import type { TextStyler } from '@/lib/text-styler';
import { formatTable, type TableCell } from '@/lib/text-table';
import type { StatusReport, WorkspaceStatus } from '@/use-cases/report-status-use-case/factory';

/** The `Skills` section of `grimoire status`: a title line, then one row per skill and one column per workspace. */
export function formatSkillsSection(params: {
  report: StatusReport;
  textStyler: TextStyler;
  maxWidth?: number;
}): string[] {
  const { report, textStyler, maxWidth } = params;
  const { workspaceStatuses, storeStatus } = report;
  const { skills, notDeployed } = storeStatus;
  const skillCount = `${skills.length} in ${storeStatus.path}`;

  const title = formatSectionTitle({
    title: 'Skills',
    caption: notDeployed.length > 0 ? `${skillCount} · ${notDeployed.length} not deployed` : skillCount,
    captionStyle: 'dim',
    textStyler,
  });

  const rowSkills = getRowSkills(report);

  if (rowSkills.length === 0) {
    return [title];
  }

  return [
    title,
    ...formatTable({
      headers: ['SKILL', ...workspaceStatuses.map(({ name }) => name)],
      rows: rowSkills.map((skill) => [
        getSkillCell({ skill, report }),
        ...workspaceStatuses.map((workspaceStatus) => getWorkspaceCell({ skill, workspaceStatus })),
      ]),
      textStyler,
      maxWidth,
      overflow: { kind: 'split-columns', frozenColumnCount: 1 },
    }),
  ];
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** One state a workspace holds of a skill; a cell joins every mark it has. */
type Mark = Required<TableCell>;

function getRowSkills(report: StatusReport): string[] {
  const { workspaceStatuses, storeStatus } = report;

  const workspaceCloneSkills = workspaceStatuses.flatMap(({ cloned, problems }) => [
    ...cloned,
    ...getMissingCloneSkills(problems),
  ]);

  return [
    ...new Set([
      ...storeStatus.skills,
      ...workspaceCloneSkills,
      ...getWorkspaceLinkSkills(workspaceStatuses),
    ]),
  ].sort((a, b) => a.localeCompare(b));
}

function getWorkspaceLinkSkills(workspaceStatuses: WorkspaceStatus[]): string[] {
  return workspaceStatuses.flatMap(({ linked }) => linked.map(({ skill }) => skill));
}

function getSkillCell(params: { skill: string; report: StatusReport }): TableCell {
  const { skill, report } = params;
  const { workspaceStatuses, storeStatus } = report;

  if (storeStatus.skills.includes(skill)) {
    return storeStatus.notDeployed.includes(skill) ? { text: skill, style: 'dim' } : { text: skill };
  }

  return getWorkspaceLinkSkills(workspaceStatuses).includes(skill)
    ? getNotASkillCell(skill)
    : getNotInStoreCell(skill);
}

function getNotASkillCell(skill: string): TableCell {
  return { text: `${skill} (not a skill)`, style: 'yellow' };
}

function getWorkspaceCell(params: { skill: string; workspaceStatus: WorkspaceStatus }): TableCell {
  const { skill, workspaceStatus } = params;
  const { linked, cloned, problems } = workspaceStatus;

  const isUnavailable = getUnavailableState(problems) !== undefined;
  const isCloneMissing = getMissingCloneSkills(problems).includes(skill);

  const marks: Mark[] = [
    ...linked
      .filter((linkedSkill) => linkedSkill.skill === skill)
      .map(({ entry }): Mark => ({
        text: entry === skill ? 'link' : `link as ${entry}`,
        style: 'cyan',
      })),
    ...(cloned.includes(skill)
      ? [
          isUnavailable
            ? ({ text: 'clone ?', style: 'yellow' } satisfies Mark)
            : ({ text: 'clone', style: 'magenta' } satisfies Mark),
        ]
      : []),
    ...(isCloneMissing ? [{ text: 'clone missing', style: 'yellow' } satisfies Mark] : []),
  ];

  const [firstMark] = marks;

  if (firstMark === undefined) {
    return { text: isUnavailable ? '?' : '·', style: 'dim' };
  }

  return {
    text: marks.map(({ text }) => text).join(', '),
    style: marks.some(({ style }) => style === 'yellow') ? 'yellow' : firstMark.style,
  };
}
