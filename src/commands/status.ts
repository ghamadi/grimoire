import { Command } from 'commander';
import { formatOutsideClonesSection } from '@/commands/status/outside-clones-section';
import { formatProblemsSection } from '@/commands/status/problems-section';
import { formatSkillsSection } from '@/commands/status/skills-section';
import { formatWorkspacesSection } from '@/commands/status/workspaces-section';
import type { TextStyler } from '@/lib/text-styler';
import type { GrimoireStoreManager } from '@/domains/grimoire-store/index';
import {
  createReportStatusUseCase,
  type StatusReport,
} from '@/use-cases/report-status-use-case/factory';

export type StatusCommandParams = {
  storeManager: GrimoireStoreManager;
  textStyler: TextStyler;
};

/** `grimoire status`: every deployment, as tables. Prints problems, never fails on them. */
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

function formatStatus(params: { report: StatusReport; textStyler: TextStyler }): string[] {
  const sections = [
    formatWorkspacesSection(params),
    formatSkillsSection(params),
    formatOutsideClonesSection(params),
    formatProblemsSection(params),
  ].filter((section) => section.length > 0);

  return sections.flatMap((section, index) => (index === 0 ? section : ['', ...section]));
}
