import { Command } from 'commander';
import type { GrimoireStoreManager } from '@/domains/grimoire-store/index';
import { ExportFailedError, describeExportRefusal } from '@/lib/errors/index';
import {
  createExportSkillsUseCase,
  type ExportSkillsReport,
} from '@/use-cases/export-skills-use-case/factory';

export type ExportCommandParams = {
  storeManager: GrimoireStoreManager;
};

export function exportCommand(params: ExportCommandParams): Command {
  const { storeManager } = params;
  const exportSkills = createExportSkillsUseCase({ storeManager });

  const command = new Command('export')
    .description('Copy store skills into a repo, replacing what is there')
    .argument('<repo>', 'registered repo to export into')
    .argument('[skills...]', 'store skills to export, unless --all-skills')
    .option('--all-skills', 'export every skill the store holds')
    .option(
      '--force',
      'replace the destination even when git reports uncommitted changes there, potentially overwriting them',
    )
    .action((repo: string, skills: string[], options: { allSkills?: boolean; force?: boolean }) => {
      const { allSkills, force } = options;

      if (skills.length > 0 && allSkills) {
        command.error('error: --all-skills cannot be combined with named skills');
      }

      if (skills.length === 0 && !allSkills) {
        command.error("error: missing required argument 'skills' (or use --all-skills)");
      }

      const skillNames = allSkills ? storeManager.listSkillNames() : skills;

      const result = exportSkills({ repoName: repo, skillNames, force });

      // After the use case, not before it: an empty store still gets the repo checks.
      if (skillNames.length === 0) {
        console.log('nothing to export: the store holds no skills');
        return;
      }

      report(result);

      if (result.failed.length > 0) {
        throw new ExportFailedError({ failures: result.failed });
      }
    });

  return command;
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
