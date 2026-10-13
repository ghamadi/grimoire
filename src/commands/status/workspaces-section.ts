import { getUnavailableState } from '@/commands/status/section-helpers';
import { formatSectionTitle } from '@/commands/status/section-title';
import type { TextStyler } from '@/lib/text-styler';
import { formatTable, type TableCell } from '@/lib/text-table';
import type { StatusReport, WorkspaceStatus } from '@/use-cases/report-status-use-case/factory';

/** The `Workspaces` section of `grimoire status`: a title line, then one row per registered workspace. */
export function formatWorkspacesSection(params: {
  report: StatusReport;
  textStyler: TextStyler;
}): string[] {
  const { report, textStyler } = params;
  const { workspaceStatuses } = report;

  const title = formatSectionTitle({
    title: 'Workspaces',
    caption:
      workspaceStatuses.length === 0 ? 'none registered' : `${workspaceStatuses.length} registered`,
    captionStyle: 'dim',
    textStyler,
  });

  if (workspaceStatuses.length === 0) {
    return [title];
  }

  return [
    title,
    ...formatTable({
      headers: ['NAME', 'MODE', 'STATE', 'PATH'],
      rows: workspaceStatuses.map((workspaceStatus): TableCell[] => [
        { text: workspaceStatus.name },
        { text: workspaceStatus.autoLink ? 'auto-link' : 'manual' },
        getStateCell(workspaceStatus),
        { text: workspaceStatus.path },
      ]),
      textStyler,
    }),
  ];
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function getStateCell({ problems }: WorkspaceStatus): TableCell {
  const unavailableState = getUnavailableState(problems);

  if (unavailableState !== undefined) {
    return { text: unavailableState, style: 'yellow' };
  }

  if (problems.length === 0) {
    return { text: 'ok', style: 'green' };
  }

  return {
    text: problems.length === 1 ? '1 problem' : `${problems.length} problems`,
    style: 'yellow',
  };
}
