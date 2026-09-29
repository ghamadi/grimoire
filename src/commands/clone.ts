import { Command } from 'commander';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { describeCloneRefusal } from '#src/lib/errors/index';
import {
  createCloneSkillUseCase,
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
    .option('--adopt', 'record a skill directory already at the destination instead of declining it')
    .action((skill: string, workspaces: string[], options: { adopt?: boolean }) => {
      report(cloneSkill({ skillName: skill, workspaces, adopt: options.adopt }));
    });
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function report(result: ReturnType<CloneSkillUseCase>): void {
  const { cloned, adopted, alreadyCloned, declined } = result;

  for (const { skill, workspace, replacedLink } of cloned) {
    console.log(`cloned ${skill} → ${workspace}${replacedLink ? ' (replaced the link)' : ''}`);
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
}
