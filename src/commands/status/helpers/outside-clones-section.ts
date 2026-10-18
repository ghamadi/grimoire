import { getMissingCloneSkills, getNotInStoreCell } from '@/commands/status/helpers/section-helpers';
import { formatSectionTitle } from '@/commands/status/helpers/section-title';
import type { TextStyler } from '@/lib/text-styler';
import { formatTable, type TableCell } from '@/lib/text-table';
import type {
  RecordedPathStatus,
  StatusReport,
  StoreStatus,
} from '@/use-cases/report-status-use-case/factory';

const OUTSIDE_CLONE_HEADERS = ['SKILL', 'STATE', 'DIRECTORY'];

/**
 * The `Clones outside workspaces` section of `grimoire status`: a title line, then one row
 * per clone recorded by path. No lines when there is no such clone.
 */
export function formatOutsideClonesSection(params: {
  report: StatusReport;
  textStyler: TextStyler;
  maxWidth?: number;
}): string[] {
  const { report, textStyler, maxWidth } = params;
  const { recordedPathStatuses, storeStatus } = report;

  const rows = recordedPathStatuses.flatMap((recordedPathStatus) =>
    getDirectoryRows({ recordedPathStatus, storeStatus }),
  );

  if (rows.length === 0) {
    return [];
  }

  return [
    formatSectionTitle({
      title: 'Clones outside workspaces',
      caption: 'directories recorded by path',
      captionStyle: 'dim',
      textStyler,
    }),
    ...formatTable({
      headers: OUTSIDE_CLONE_HEADERS,
      rows,
      textStyler,
      maxWidth,
      overflow: { kind: 'wrap-column', columnIndex: OUTSIDE_CLONE_HEADERS.indexOf('DIRECTORY') },
    }),
  ];
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function getDirectoryRows(params: {
  recordedPathStatus: RecordedPathStatus;
  storeStatus: StoreStatus;
}): TableCell[][] {
  const { recordedPathStatus, storeStatus } = params;
  const { path, cloned, problems } = recordedPathStatus;

  return [...cloned, ...getMissingCloneSkills(problems)]
    .sort((a, b) => a.localeCompare(b))
    .map((skill) => [
      storeStatus.skills.includes(skill) ? { text: skill } : getNotInStoreCell(skill),
      cloned.includes(skill)
        ? { text: 'present', style: 'magenta' }
        : { text: 'missing', style: 'yellow' },
      { text: path },
    ]);
}
