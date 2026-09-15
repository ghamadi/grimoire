import { Command } from 'commander';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { describeUnlinkRefusal } from '#src/lib/errors/index';
import {
  createUnlinkSkillUseCase,
  type UnlinkSkillUseCase,
} from '#src/use-cases/unlink-skill-use-case/factory';

export type UnlinkCommandParams = {
  storeManager: GrimoireStoreManager;
};

export function unlinkCommand(params: UnlinkCommandParams): Command {
  const { storeManager } = params;
  const unlinkSkill = createUnlinkSkillUseCase({ storeManager });

  const command = new Command('unlink')
    .description("Remove a skill's links from workspaces")
    .argument('<skill>', 'skill to unlink')
    .argument('[workspaces...]', 'registered names to unlink from, unless --all-workspaces')
    .option('--all-workspaces', 'unlink from every registered workspace')
    .action((skill: string, names: string[], options: { allWorkspaces?: boolean }) => {
      const { allWorkspaces } = options;

      if (names.length > 0 && allWorkspaces) {
        command.error('error: --all-workspaces cannot be combined with named workspaces');
      }

      if (names.length === 0 && !allWorkspaces) {
        command.error("error: missing required argument 'workspaces' (or use --all-workspaces)");
      }

      const workspaces = allWorkspaces ? 'all' : names;

      report(unlinkSkill({ skillName: skill, workspaces }), { workspaces });
    });

  return command;
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function report(
  result: ReturnType<UnlinkSkillUseCase>,
  { workspaces }: { workspaces: string[] | 'all' },
): void {
  const { unlinked, notLinked, declined } = result;

  const pairCount = unlinked.length + notLinked.length + declined.length;
  if (workspaces === 'all' && pairCount === 0) {
    console.log('nothing to unlink: no workspace is registered');
    return;
  }

  for (const { skill, workspace } of unlinked) {
    console.log(`unlinked ${skill} → ${workspace}`);
  }

  for (const { skill, workspace } of notLinked) {
    console.log(`not linked ${skill} → ${workspace}`);
  }

  for (const refusal of declined) {
    console.warn(`warning: ${describeUnlinkRefusal(refusal)}`);
  }
}
