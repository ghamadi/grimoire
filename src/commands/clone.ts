import { Command } from 'commander';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { CloneFailedError, describeCloneRefusal } from '@/lib/errors';
import { normalizePath } from '@/lib/paths';
import { pickChoices, type Picker } from '@/lib/picker';
import { assertUnreachable } from '@/lib/utils';
import {
  createCloneSkillUseCase,
  requireCloneableSkill,
  type CloneReplacedEntry,
  type CloneSkillUseCase,
} from '@/use-cases/clone-skill-use-case/factory';
import {
  createUncloneSkillUseCase,
  type UncloneSkillUseCase,
} from '@/use-cases/unclone-skill-use-case/factory';

export type CloneCommandParams = {
  storeManager: GrimoireStoreManager;
  picker: Picker;
};

type CloneOptions = {
  to?: string[];
  drop?: string[] | true;
  overwrite?: boolean;
};

export function cloneCommand(params: CloneCommandParams): Command {
  const { storeManager, picker } = params;
  const cloneSkill = createCloneSkillUseCase({ storeManager });
  const uncloneSkill = createUncloneSkillUseCase({ storeManager });

  const clone = new Command('clone')
    .description('Copy a store skill into workspaces, or forget its clone records')
    .argument('<skill>', 'store skill to clone, or whose clone records to forget with --drop')
    .option('--to <workspaces...>', 'registered workspaces to clone into')
    .option(
      '--overwrite',
      'replace a skill directory already at the destination with the store copy, deleting the old one',
    )
    .option(
      '--drop [targets...]',
      'registered workspace names, or recorded paths, whose clone records to forget',
    )
    .action(async (skill: string, options: CloneOptions) => {
      const parsedArguments = parseArguments({
        options,
        refuse: (message) => clone.error(message),
      });

      if (parsedArguments.mode === 'drop') {
        const targets =
          parsedArguments.targets ??
          (await pickCloneTargets({ storeManager, picker, skillName: skill }));

        if (!targets) {
          return;
        }

        reportUnclones(uncloneSkill({ skillName: skill, targets }));
        return;
      }

      const workspaces =
        parsedArguments.workspaces ??
        (await pickWorkspaceNames({ storeManager, picker, skillName: skill }));

      if (!workspaces) {
        return;
      }

      const result = cloneSkill({ skillName: skill, workspaces, overwrite: parsedArguments.overwrite });

      reportClones(result);

      if (result.failed.length > 0) {
        throw new CloneFailedError({ failures: result.failed });
      }
    });

  return clone;
}

// ----------------------------------------------------------------------------
// ARGUMENTS
// ----------------------------------------------------------------------------

type ParseArgumentsParams = {
  options: CloneOptions;
  refuse: (message: string) => never;
};

type ParsedArguments =
  | { mode: 'deploy'; workspaces: string[] | undefined; overwrite: boolean }
  | { mode: 'drop'; targets: string[] | undefined };

/** `workspaces` and `targets` are `undefined` when they are to be picked. */
function parseArguments(params: ParseArgumentsParams): ParsedArguments {
  const { options, refuse } = params;
  const { to, drop, overwrite = false } = options;

  if (to && drop) {
    return refuse('error: --to cannot be combined with --drop');
  }

  if (drop) {
    if (overwrite) {
      return refuse('error: --overwrite cannot be combined with --drop');
    }

    return { mode: 'drop', targets: Array.isArray(drop) ? drop : undefined };
  }

  return { mode: 'deploy', workspaces: to, overwrite };
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** `undefined` when there is nothing to clone into, after saying why. */
async function pickWorkspaceNames(params: {
  storeManager: GrimoireStoreManager;
  picker: Picker;
  skillName: string;
}): Promise<string[] | undefined> {
  const { storeManager, picker, skillName } = params;

  // So a mistyped skill is refused before it costs a pick.
  requireCloneableSkill({ storeManager, skillName });

  const result = await pickChoices({
    picker,
    message: `Select the workspaces to clone ${skillName} into`,
    choices: storeManager
      .listRegisteredWorkspaces()
      .map(({ name, path }) => ({ value: name, label: name, hint: path })),
    refusal: { noun: 'workspace', remedy: 'name them with --to' },
  });
  const resultKind = result.kind;

  switch (resultKind) {
    case 'picked':
      return result.values;

    case 'no-choices':
      console.log('nothing to clone: no workspace is registered');
      return undefined;

    case 'none-picked':
      console.log('nothing to clone: no workspace selected');
      return undefined;

    default:
      return assertUnreachable(resultKind);
  }
}

/** `undefined` when there is nothing to unclone, after saying why. */
async function pickCloneTargets(params: {
  storeManager: GrimoireStoreManager;
  picker: Picker;
  skillName: string;
}): Promise<string[] | undefined> {
  const { storeManager, picker, skillName } = params;

  const result = await pickChoices({
    picker,
    message: `Select the clones of ${skillName} to forget`,
    choices: storeManager.listSkillClones(skillName).map(({ record, path }) => {
      const target = 'path' in record ? normalizePath(record.path) : record.workspace;

      return { value: target, label: target, hint: path };
    }),
    refusal: { noun: 'clone', remedy: 'name them after --drop' },
  });
  const resultKind = result.kind;

  switch (resultKind) {
    case 'picked':
      return result.values;

    case 'no-choices':
      console.log(`nothing to unclone: ${skillName} has no clone records`);
      return undefined;

    case 'none-picked':
      console.log('nothing to unclone: no clone selected');
      return undefined;

    default:
      return assertUnreachable(resultKind);
  }
}

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

// ----------------------------------------------------------------------------
// REPORTS
// ----------------------------------------------------------------------------

function reportClones(result: ReturnType<CloneSkillUseCase>): void {
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

function reportUnclones(result: ReturnType<UncloneSkillUseCase>): void {
  const { uncloned, notCloned } = result;

  for (const { skill, target } of uncloned) {
    console.log(`uncloned ${skill} → ${target}`);
  }

  for (const { skill, target } of notCloned) {
    console.log(`not cloned ${skill} → ${target}`);
  }
}
