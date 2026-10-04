import { Command } from 'commander';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { CloneFailedError, describeCloneRefusal } from '#src/lib/errors/index';
import { assertUnreachable } from '#src/lib/utils';
import {
  createCloneSkillUseCase,
  type CloneReplacedEntry,
  type CloneSkillUseCase,
} from '#src/use-cases/clone-skill-use-case/factory';

export type CloneCommandParams = {
  storeManager: GrimoireStoreManager;
};

export function cloneCommand(params: CloneCommandParams): Command {
  const { storeManager } = params;
  const cloneSkill = createCloneSkillUseCase({ storeManager });

  return new Command('clone')
    .description('Copy a store skill into workspaces')
    .argument('<skill>', 'skill to clone')
    .argument('<workspaces...>', 'registered names to clone into')
    .option(
      '--overwrite',
      'replace a skill directory already at the destination with the store copy, deleting the old one',
    )
    .action((skill: string, workspaces: string[], options: { overwrite?: boolean }) => {
      const result = cloneSkill({ skillName: skill, workspaces, overwrite: options.overwrite });

      report(result);

      if (result.failed.length > 0) {
        throw new CloneFailedError({ failures: result.failed });
      }
    });
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function formatReplacedSuffix(replaced: CloneReplacedEntry): string {
  switch (replaced) {
    case 'nothing':
      return '';
    case 'link':
      return ' (replaced the link)';
    case 'directory':
      return ' (replaced the directory)';
    default:
      return assertUnreachable(replaced);
  }
}

function report(result: ReturnType<CloneSkillUseCase>): void {
  const { cloned, adopted, alreadyCloned, declined } = result;

  for (const { skill, workspace, replaced } of cloned) {
    console.log(`cloned ${skill} → ${workspace}${formatReplacedSuffix(replaced)}`);
  }

  for (const { skill, workspace } of adopted) {
    console.log(`adopted ${skill} → ${workspace}`);
  }

  for (const { skill, workspace } of alreadyCloned) {
    console.log(`already cloned ${skill} → ${workspace}`);
  }

  for (const refusal of declined) {
    console.warn(`warning: ${describeCloneRefusal(refusal)}`);
  }

  for (const { skill, workspace, strandedOldEntry } of cloned) {
    if (strandedOldEntry) {
      console.warn(
        `warning: cloned ${skill} → ${workspace}, but the old copy at ${strandedOldEntry.path} could not be fully deleted: ${strandedOldEntry.error.message}`,
      );
    }
  }
}
