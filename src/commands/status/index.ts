import { Command } from 'commander';
import { formatOutsideClonesSection } from '@/commands/status/helpers/outside-clones-section';
import { formatProblemsSection } from '@/commands/status/helpers/problems-section';
import { formatSkillsSection } from '@/commands/status/helpers/skills-section';
import { formatWorkspacesSection } from '@/commands/status/helpers/workspaces-section';
import type { TextStyler } from '@/lib/text-styler';
import type { GrimoireStoreManager } from '@/domains/grimoire-store/index';
import {
  createReportStatusUseCase,
  type StatusReport,
} from '@/use-cases/report-status-use-case/factory';

export type StatusCommandParams = {
  storeManager: GrimoireStoreManager;
  textStyler: TextStyler;
  getTerminalWidth: () => number | undefined;
};

/** `grimoire status`: every deployment, as tables. Prints problems, never fails on them. */
export function statusCommand(params: StatusCommandParams): Command {
  const { storeManager, textStyler, getTerminalWidth } = params;
  const reportStatus = createReportStatusUseCase({ storeManager });

  return new Command('status')
    .description('Show where skills are deployed, and what has gone stale')
    .action(() => {
      const maxWidth = getTerminalWidth();

      for (const line of formatStatus({ report: reportStatus(), textStyler, maxWidth })) {
        console.log(line);
      }
    });
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function formatStatus(params: {
  report: StatusReport;
  textStyler: TextStyler;
  maxWidth: number | undefined;
}): string[] {
  const { report, textStyler } = params;

  const sections = [
    formatWorkspacesSection(params),
    formatSkillsSection(params),
    formatOutsideClonesSection(params),
    formatProblemsSection({ report, textStyler }),
  ].filter((section) => section.length > 0);

  return sections.flatMap((section, index) => (index === 0 ? section : ['', ...section]));
}
