import { Command } from 'commander';
import { formatProblemsSection } from '@/commands/status/problems-section';
import type { TextStyle, TextStyler } from '@/lib/text-styler';
import type { GrimoireStoreManager } from '@/domains/grimoire-store/index';
import {
  createReportStatusUseCase,
  type DeploymentProblem,
  type LinkedSkill,
  type RecordedPathStatus,
  type StatusReport,
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
const CONTENT_LABEL_WIDTH = 7;

const WORKSPACE_STATE_BY_PROBLEM_KIND: Partial<Record<DeploymentProblem['kind'], string>> = {
  'workspace-unreachable': 'unreachable',
  'workspace-unreadable': 'unreadable',
};

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

  return [
    ...formattedBlocks.flatMap((block, index) => (index === 0 ? block : ['', ...block])),
    '',
    ...formatProblemsSection({ report, textStyler }),
  ];
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
    ...problems.flatMap(({ kind }) => {
      const state = WORKSPACE_STATE_BY_PROBLEM_KIND[kind];

      return state === undefined ? [] : [`  ${textStyler('dim', state)}`];
    }),
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
  const { path, cloned } = recordedPathStatus;

  return [
    `${textStyler('bold', path)}  ${textStyler('dim', 'recorded by path')}`,
    ...(cloned.length > 0
      ? [formatContentLine({ label: 'cloned', labelStyle: 'cyan', text: cloned.join(', '), textStyler })]
      : []),
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
  ];
}

function formatContentLine(params: {
  label: string;
  labelStyle: TextStyle;
  text: string;
  textStyler: TextStyler;
}): string {
  const { label, labelStyle, text, textStyler } = params;
  const paddedLabel = formatPaddedStyledToken({
    token: label,
    width: CONTENT_LABEL_WIDTH,
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
