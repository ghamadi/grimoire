import { formatSectionTitle } from '@/commands/status/helpers/section-title';
import { formatShellCommand } from '@/lib/shell-command';
import type { TextStyler } from '@/lib/text-styler';
import { assertUnreachable } from '@/lib/utils';
import type {
  DeploymentProblem,
  StatusReport,
  StoreProblem,
} from '@/use-cases/report-status-use-case/factory';

type ProblemEntry = { headline: string; lines: ProblemEntryLine[] };

/** `commandArguments` are the words after `grimoire` on the line. */
type ProblemEntryLine = { sentence: string } | { commandArguments: string[] };

type ProblemLocation = {
  /** How a headline names the place: `workspace <name>`, or a recorded path's directory. */
  label: string;
  /** What a fix command takes: the workspace name, or a recorded path's directory. */
  target: string;
  path: string;
};

/** The `Problems` section of `grimoire status`: a title line, then one entry per problem. */
export function formatProblemsSection(params: {
  report: StatusReport;
  textStyler: TextStyler;
}): string[] {
  const { report, textStyler } = params;
  const problemEntries = getProblemEntries(report);

  if (problemEntries.length === 0) {
    return [
      formatSectionTitle({ title: 'Problems', caption: 'none ✓', captionStyle: 'green', textStyler }),
    ];
  }

  const lines = [
    formatSectionTitle({
      title: 'Problems',
      caption: `${problemEntries.length}`,
      captionStyle: 'yellow',
      textStyler,
    }),
  ];

  for (const problemEntry of problemEntries) {
    lines.push('', ...formatProblemEntry({ problemEntry, textStyler }));
  }

  return lines;
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function getProblemEntries(report: StatusReport): ProblemEntry[] {
  const { workspaceStatuses, recordedPathStatuses, storeStatus } = report;

  return [
    ...workspaceStatuses.flatMap(({ name, path, problems }) =>
      problems.map((problem) =>
        describeDeploymentProblem({
          problem,
          location: { label: `workspace ${name}`, target: name, path },
        }),
      ),
    ),
    ...recordedPathStatuses.flatMap(({ path, problems }) =>
      problems.map((problem) =>
        describeDeploymentProblem({ problem, location: { label: path, target: path, path } }),
      ),
    ),
    ...storeStatus.problems.map((problem) =>
      describeStoreProblem({ problem, statePath: storeStatus.statePath }),
    ),
  ];
}

function formatProblemEntry(params: { problemEntry: ProblemEntry; textStyler: TextStyler }): string[] {
  const { problemEntry, textStyler } = params;

  return [
    `  ${textStyler('yellow', '!')} ${textStyler('bold', problemEntry.headline)}`,
    ...problemEntry.lines.map((line) =>
      'commandArguments' in line
        ? `      ${textStyler('cyan', formatShellCommand(['grimoire', ...line.commandArguments]))}`
        : `    ${line.sentence}`,
    ),
  ];
}

function describeDeploymentProblem(params: {
  problem: DeploymentProblem;
  location: ProblemLocation;
}): ProblemEntry {
  const { problem, location } = params;
  const { label, target, path } = location;

  switch (problem.kind) {
    case 'workspace-unreachable':
      return {
        headline: `${label} is unreachable`,
        lines: [
          { sentence: `${path} does not resolve.` },
          { sentence: 'Make it readable, or unregister it:' },
          { commandArguments: ['workspaces', 'remove', target] },
        ],
      };

    case 'workspace-unreadable':
      return {
        headline: `${label} is unreadable`,
        lines: [
          { sentence: `${path} cannot be read.` },
          { sentence: 'Make it readable, or unregister it anyway:' },
          { commandArguments: ['workspaces', 'remove', target, '--force'] },
        ],
      };

    case 'dangling-link':
      return {
        headline: `link ${problem.entry} in ${label} resolves nowhere`,
        lines: [
          { sentence: 'It points into the store, at a skill that is not there.' },
          { sentence: 'Delete the link yourself.' },
        ],
      };

    case 'clone-not-in-store':
      return {
        headline: `clone of ${problem.skill} in ${label} is no longer in the store`,
        lines: [
          { sentence: 'Forget the record:' },
          { commandArguments: ['clone', problem.skill, '--drop', target] },
        ],
      };

    case 'clone-missing':
      return {
        headline: `clone of ${problem.skill} in ${label} is missing`,
        lines: problem.recloneable
          ? [
              { sentence: 'Copy it again:' },
              { commandArguments: ['clone', problem.skill, '--to', target] },
              { sentence: 'Or forget the record:' },
              { commandArguments: ['clone', problem.skill, '--drop', target] },
            ]
          : [
              { sentence: 'Forget the record:' },
              { commandArguments: ['clone', problem.skill, '--drop', target] },
            ],
      };

    default:
      return assertUnreachable(problem);
  }
}

function describeStoreProblem(params: { problem: StoreProblem; statePath: string }): ProblemEntry {
  const { problem, statePath } = params;

  switch (problem.kind) {
    case 'stray-entry':
      return {
        headline: `store entry ${problem.entry} is not a skill directory`,
        lines: [
          {
            sentence: `Move it out of the store, or add it to "ignore" in ${statePath}.`,
          },
        ],
      };

    default:
      return assertUnreachable(problem.kind);
  }
}
