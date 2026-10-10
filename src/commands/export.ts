import { Command } from 'commander';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { ExportFailedError, describeExportRefusal } from '#src/lib/errors/index';
import {
  createExportSkillsUseCase,
  type ExportSkillsReport,
} from '#src/use-cases/export-skills-use-case/factory';

export type ExportCommandParams = {
  storeManager: GrimoireStoreManager;
};

export function exportCommand(params: ExportCommandParams): Command {
  const { storeManager } = params;
  const exportSkills = createExportSkillsUseCase({ storeManager });

  return new Command('export')
    .description('Copy store skills into a repo, replacing what is there')
    .argument('<repo>', 'registered repo to export into')
    .argument('<skills...>', 'store skills to export')
    .option(
      '--force',
      'replace the destination even when git reports uncommitted changes there, potentially overwriting them',
    )
    .action((repo: string, skills: string[], options: { force?: boolean }) => {
      const result = exportSkills({ repoName: repo, skillNames: skills, force: options.force });

      report(result);

      if (result.failed.length > 0) {
        throw new ExportFailedError({ failures: result.failed });
      }
    });
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function report(result: ExportSkillsReport): void {
  const { exported, declined } = result;

  for (const { skill, repo } of exported) {
    console.log(`exported ${skill} → ${repo}`);
  }

  for (const refusal of declined) {
    console.warn(`warning: ${describeExportRefusal(refusal)}`);
  }

  for (const { skill, repo, strandedOldEntry } of exported) {
    if (strandedOldEntry) {
      console.warn(
        `warning: exported ${skill} → ${repo}, but the old copy at ${strandedOldEntry.path} could not be fully deleted: ${strandedOldEntry.error.message}`,
      );
    }
  }
}
