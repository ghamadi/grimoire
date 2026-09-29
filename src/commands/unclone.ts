import { Command } from 'commander';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import {
  createUncloneSkillUseCase,
  type UncloneSkillUseCase,
} from '#src/use-cases/unclone-skill-use-case/factory';

export type UncloneCommandParams = {
  storeManager: GrimoireStoreManager;
};

export function uncloneCommand(params: UncloneCommandParams): Command {
  const { storeManager } = params;
  const uncloneSkill = createUncloneSkillUseCase({ storeManager });

  return new Command('unclone')
    .description('Forget clone records')
    .argument('<skill>', 'skill whose clones to forget')
    .argument('<targets...>', 'registered workspace names, or recorded paths')
    .action((skill: string, targets: string[]) => {
      report(uncloneSkill({ skillName: skill, targets }));
    });
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function report(result: ReturnType<UncloneSkillUseCase>): void {
  const { uncloned, notCloned } = result;

  for (const { skill, target } of uncloned) {
    console.log(`uncloned ${skill} → ${target}`);
  }

  for (const { skill, target } of notCloned) {
    console.log(`not cloned ${skill} → ${target}`);
  }
}
