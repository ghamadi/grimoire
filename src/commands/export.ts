import { Command } from 'commander';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { ExportFailedError, describeExportRefusal } from '@/lib/errors';
import { formatMissingArgument } from '@/lib/missing-argument';
import { pickChoices, type Picker } from '@/lib/picker';
import { assertUnreachable } from '@/lib/utils';
import {
  createExportSkillsUseCase,
  requireExportableSkills,
  type ExportSkillsReport,
} from '@/use-cases/export-skills-use-case/factory';

export type ExportCommandParams = {
  storeManager: GrimoireStoreManager;
  picker: Picker;
};

export function exportCommand(params: ExportCommandParams): Command {
  const { storeManager, picker } = params;
  const exportSkills = createExportSkillsUseCase({ storeManager });

  const command = new Command('export')
    .description('Copy store skills into a repo, replacing what is there')
    .argument('[skills...]', 'store skills to export, unless --all-skills')
    .option('--to <repos...>', 'registered repos to export into')
    .option('--all-skills', 'export every skill the store holds')
    .option(
      '--force',
      'replace the destination even when git reports uncommitted changes there, potentially overwriting them',
    )
    .action(
      async (skills: string[], options: { to?: string[]; allSkills?: boolean; force?: boolean }) => {
        const { to, allSkills, force } = options;

        if (skills.length > 0 && allSkills) {
          command.error('error: --all-skills cannot be combined with named skills');
        }

        if (skills.length === 0 && !allSkills) {
          command.error(
            formatMissingArgument({
              name: 'skills',
              allFlag: '--all-skills',
              listFlag: to ? '--to' : undefined,
            }),
          );
        }

        const skillNames = allSkills ? storeManager.listSkillNames() : skills;

        if (skillNames.length === 0) {
          console.log('nothing to export: the store holds no skills');
          return;
        }

        const repoNames = to ?? (await pickRepoNames({ storeManager, picker, skillNames }));

        if (!repoNames) {
          return;
        }

        const result = exportSkills({ skillNames, repoNames, force });

        report(result);

        if (result.failed.length > 0) {
          throw new ExportFailedError({ failures: result.failed });
        }
      },
    );

  return command;
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** `undefined` when there is nothing to export into, after saying why. */
async function pickRepoNames(params: {
  storeManager: GrimoireStoreManager;
  picker: Picker;
  skillNames: string[];
}): Promise<string[] | undefined> {
  const { storeManager, picker, skillNames } = params;

  // So a mistyped skill is refused before it costs a pick.
  requireExportableSkills({ storeManager, skillNames });

  const result = await pickChoices({
    picker,
    message: 'Select the repos to export into',
    choices: storeManager
      .listRegisteredRepos()
      .map(({ name, path }) => ({ value: name, label: name, hint: path })),
    refusal: { noun: 'repo', remedy: 'name them with --to' },
  });
  const resultKind = result.kind;

  switch (resultKind) {
    case 'picked':
      return result.values;

    case 'no-choices':
      console.log('nothing to export: no repo is registered');
      return undefined;

    case 'none-picked':
      console.log('nothing to export: no repo selected');
      return undefined;

    default:
      return assertUnreachable(resultKind);
  }
}

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
