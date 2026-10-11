import { Command } from 'commander';
import type { TextStyle, TextStyler } from '@/lib/text-styler';
import type { GrimoireStoreManager } from '@/domains/grimoire-store/index';
import { assertUnreachable } from '@/lib/utils';
import {
  createReportStatusUseCase,
  type DeploymentProblem,
  type LinkedSkill,
  type RecordedPathStatus,
  type StatusReport,
  type StoreProblem,
  type StoreStatus,
  type WorkspaceStatus,
} from '@/use-cases/report-status-use-case/factory';

export type StatusCommandParams = {
  storeManager: GrimoireStoreManager;
  textStyler: TextStyler;
};

/** `grimoire status`: every deployment, grouped by where it lives. Prints problems, never fails on them. */
export function statusCommand(params: StatusCommandParams): Command {
  const { storeManager, textStyler } = params;
  const reportStatus = createReportStatusUseCase({ storeManager });

  return new Command('status')
    .description('Show where skills are deployed, and what has gone stale')
    .action(() => {
      for (const line of formatStatus({ report: reportStatus(), textStyler })) {
        console.log(line);
      }
    });
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

const STORE_LABEL = 'store';
const AUTO_LINK_LABEL = 'auto-link';
const MANUAL_LABEL = 'manual';
const PROBLEM_LABEL = 'problem';

function formatStatus(params: { report: StatusReport; textStyler: TextStyler }): string[] {
  const { report, textStyler } = params;
  const nameWidth = Math.max(
    STORE_LABEL.length,
    ...report.workspaceStatuses.map(({ name }) => name.length),
  );

  const formattedBlocks = [
    ...(report.workspaceStatuses.length === 0
      ? [['No workspaces registered.']]
      : report.workspaceStatuses.map((workspaceStatus) =>
          formatWorkspaceStatusBlock({ workspaceStatus, nameWidth, textStyler }),
        )),
    ...report.recordedPathStatuses.map((recordedPathStatus) =>
      formatRecordedPathBlock({ recordedPathStatus, textStyler }),
    ),
    formatStoreBlock({ storeStatus: report.storeStatus, nameWidth, textStyler }),
  ];

  return formattedBlocks.flatMap((block, index) => (index === 0 ? block : ['', ...block]));
}

function formatWorkspaceStatusBlock(params: {
  workspaceStatus: WorkspaceStatus;
  nameWidth: number;
  textStyler: TextStyler;
}): string[] {
  const { workspaceStatus, nameWidth, textStyler } = params;
  const { name, path, autoLink, linked, cloned, problems } = workspaceStatus;
  const mode = autoLink ? AUTO_LINK_LABEL : MANUAL_LABEL;

  const content = [
    ...(linked.length > 0
      ? [
          formatContentLine({
            label: 'linked',
            labelStyle: 'cyan',
            text: linked.map(describeLinked).join(', '),
            textStyler,
          }),
        ]
      : []),
    ...(cloned.length > 0
      ? [formatContentLine({ label: 'cloned', labelStyle: 'cyan', text: cloned.join(', '), textStyler })]
      : []),
    ...problems.map((problem) =>
      formatContentLine({
        label: PROBLEM_LABEL,
        labelStyle: 'yellow',
        text: describeDeploymentProblem(problem, { target: name, path }),
        textStyler,
      }),
    ),
  ];

  return [
    [
      formatPaddedStyledToken({ token: name, width: nameWidth, style: 'bold', textStyler }),
      formatPaddedStyledToken({ token: mode, width: AUTO_LINK_LABEL.length, style: 'dim', textStyler }),
      textStyler('dim', path),
    ].join('  '),
    ...(content.length > 0 ? content : [`  ${textStyler('dim', 'nothing deployed')}`]),
  ];
}

function formatRecordedPathBlock(params: {
  recordedPathStatus: RecordedPathStatus;
  textStyler: TextStyler;
}): string[] {
  const { recordedPathStatus, textStyler } = params;
  const { path, cloned, problems } = recordedPathStatus;

  return [
    `${textStyler('bold', path)}  ${textStyler('dim', 'recorded by path')}`,
    ...(cloned.length > 0
      ? [formatContentLine({ label: 'cloned', labelStyle: 'cyan', text: cloned.join(', '), textStyler })]
      : []),
    ...problems.map((problem) =>
      formatContentLine({
        label: PROBLEM_LABEL,
        labelStyle: 'yellow',
        text: describeDeploymentProblem(problem, { target: path, path }),
        textStyler,
      }),
    ),
  ];
}

function formatStoreBlock(params: {
  storeStatus: StoreStatus;
  nameWidth: number;
  textStyler: TextStyler;
}): string[] {
  const { storeStatus, nameWidth, textStyler } = params;

  return [
    `${formatPaddedStyledToken({ token: STORE_LABEL, width: nameWidth, style: 'bold', textStyler })}  ${textStyler('dim', storeStatus.path)}`,
    ...(storeStatus.skills.length === 0 ? [`  ${textStyler('dim', 'no skills')}`] : []),
    ...(storeStatus.notDeployed.length > 0
      ? [
          formatContentLine({
            label: 'not deployed',
            labelStyle: 'dim',
            text: storeStatus.notDeployed.join(', '),
            textStyler,
          }),
        ]
      : []),
    ...storeStatus.problems.map((problem) =>
      formatContentLine({
        label: PROBLEM_LABEL,
        labelStyle: 'yellow',
        text: describeStoreProblem(problem, { statePath: storeStatus.statePath }),
        textStyler,
      }),
    ),
  ];
}

/** Labels are padded to `problem`, the longest of the short ones; `not deployed` overruns it. */
function formatContentLine(params: {
  label: string;
  labelStyle: TextStyle;
  text: string;
  textStyler: TextStyler;
}): string {
  const { label, labelStyle, text, textStyler } = params;
  const paddedLabel = formatPaddedStyledToken({
    token: label,
    width: PROBLEM_LABEL.length,
    style: labelStyle,
    textStyler,
  });

  return `  ${paddedLabel}  ${text}`;
}

function formatPaddedStyledToken(params: {
  token: string;
  width: number;
  style: TextStyle;
  textStyler: TextStyler;
}): string {
  const { token, width, style, textStyler } = params;

  return textStyler(style, token) + ' '.repeat(Math.max(0, width - token.length));
}

function describeLinked({ skill, entry }: LinkedSkill): string {
  return skill === entry ? skill : `${skill} (entry "${entry}")`;
}

/** `target` is what the remedy command takes: the workspace name, or the path in a recorded-path block. */
function describeDeploymentProblem(
  problem: DeploymentProblem,
  where: { target: string; path: string },
): string {
  switch (problem.kind) {
    case 'workspace-unreachable':
      return `${where.path} does not resolve — make it readable, or unregister it with \`grimoire workspaces remove ${where.target}\``;

    case 'workspace-unreadable':
      return `${where.path} cannot be read — make it readable, or unregister it anyway with \`grimoire workspaces remove ${where.target} --force\``;

    case 'dangling-link':
      return `${problem.entry} is a link into the store that resolves nowhere — delete it yourself`;

    case 'clone-not-in-store':
      return `${problem.skill} is no longer in the store — forget the record with \`grimoire unclone ${problem.skill} ${where.target}\``;

    case 'clone-missing': {
      const forget = `forget it with \`grimoire unclone ${problem.skill} ${where.target}\``;

      return problem.recloneable
        ? `the clone of ${problem.skill} is missing — copy it again with \`grimoire clone ${problem.skill} ${where.target}\`, or ${forget}`
        : `the clone of ${problem.skill} is missing — ${forget}`;
    }

    default:
      return assertUnreachable(problem);
  }
}

function describeStoreProblem(problem: StoreProblem, where: { statePath: string }): string {
  switch (problem.kind) {
    case 'clone-unregistered-workspace':
      return `a clone of ${problem.skill} is recorded under "${problem.workspace}", which is not registered — remove it from ${where.statePath}`;

    case 'stray-entry':
      return `${problem.entry} is not a skill directory — move it out of the store, or add it to "ignore" in ${where.statePath}`;

    default:
      return assertUnreachable(problem);
  }
}
