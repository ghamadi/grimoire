import { Command } from 'commander';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { describeLinkRefusal, describeUnlinkRefusal } from '@/lib/errors';
import { formatMissingArgument } from '@/lib/missing-argument';
import { pickChoices, type Picker } from '@/lib/picker';
import { assertUnreachable } from '@/lib/utils';
import { createLinkSkillUseCase, type LinkSkillUseCase } from '@/use-cases/link-skill-use-case/factory';
import {
  createUnlinkSkillUseCase,
  type UnlinkSkillUseCase,
} from '@/use-cases/unlink-skill-use-case/factory';

export type LinkCommandParams = {
  storeManager: GrimoireStoreManager;
  picker: Picker;
};

type LinkOptions = {
  to?: string[];
  drop?: string[] | true;
  allSkills?: boolean;
  allWorkspaces?: boolean;
};

export function linkCommand(params: LinkCommandParams): Command {
  const { storeManager, picker } = params;
  const linkSkill = createLinkSkillUseCase({ storeManager });
  const unlinkSkill = createUnlinkSkillUseCase({ storeManager });

  const link = new Command('link')
    .description('Symlink store skills into workspaces, or remove their links')
    .argument('[skill]', 'store skill to link, or to unlink with --drop')
    .option(
      '--to <workspaces...>',
      'registered workspaces to link into (default: every auto-link workspace)',
    )
    .option('--all-skills', 'link every skill the store holds')
    .option('--drop [workspaces...]', 'registered workspaces to remove the link from')
    .option('--all-workspaces', 'with --drop, remove the link from every registered workspace')
    .action(async (skill: string | undefined, options: LinkOptions) => {
      const parsedArguments = parseArguments({
        skill,
        options,
        refuse: (message) => link.error(message),
      });

      if (parsedArguments.mode === 'drop') {
        const { skillName } = parsedArguments;
        const workspaces =
          parsedArguments.workspaces ?? (await pickWorkspaceNames({ storeManager, picker, skillName }));

        if (!workspaces) {
          return;
        }

        reportUnlinks(unlinkSkill({ skillName, workspaces }), { workspaces });
        return;
      }

      const skillNames = parsedArguments.skillName
        ? [parsedArguments.skillName]
        : storeManager.listSkillNames();

      if (skillNames.length === 0) {
        console.log('nothing to link: the store holds no skills');
        return;
      }

      reportLinks(linkSkill({ skillNames, workspaces: parsedArguments.workspaces }), {
        autoLinkExpected: parsedArguments.workspaces === undefined,
      });
    });

  return link;
}

// ----------------------------------------------------------------------------
// ARGUMENTS
// ----------------------------------------------------------------------------

type ParseArgumentsParams = {
  skill: string | undefined;
  options: LinkOptions;
  refuse: (message: string) => never;
};

type ParsedArguments =
  | { mode: 'deploy'; skillName: string | undefined; workspaces: string[] | undefined }
  | { mode: 'drop'; skillName: string; workspaces: string[] | 'all' | undefined };

/**
 * A deploy `skillName` is `undefined` under `--all-skills`; drop `workspaces`
 * is `undefined` when they are to be picked.
 */
function parseArguments(params: ParseArgumentsParams): ParsedArguments {
  const { skill, options, refuse } = params;
  const { to, drop, allSkills, allWorkspaces } = options;

  if (to && drop) {
    return refuse('error: --to cannot be combined with --drop');
  }

  if (drop) {
    if (allSkills) {
      return refuse('error: --all-skills cannot be combined with --drop');
    }

    if (Array.isArray(drop) && allWorkspaces) {
      return refuse('error: --all-workspaces cannot be combined with named workspaces');
    }

    if (!skill) {
      return refuse(
        formatMissingArgument({ name: 'skill', listFlag: Array.isArray(drop) ? '--drop' : undefined }),
      );
    }

    return {
      mode: 'drop',
      skillName: skill,
      workspaces: Array.isArray(drop) ? drop : allWorkspaces ? 'all' : undefined,
    };
  }

  if (allWorkspaces) {
    return refuse('error: --all-workspaces works only with --drop');
  }

  if (allSkills && skill) {
    return refuse('error: --all-skills cannot be combined with a named skill');
  }

  if (!allSkills && !skill) {
    return refuse(
      formatMissingArgument({
        name: 'skill',
        allFlag: '--all-skills',
        listFlag: to ? '--to' : undefined,
      }),
    );
  }

  return { mode: 'deploy', skillName: skill, workspaces: to };
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** `undefined` when there is nothing to unlink from, after saying why. */
async function pickWorkspaceNames(params: {
  storeManager: GrimoireStoreManager;
  picker: Picker;
  skillName: string;
}): Promise<string[] | undefined> {
  const { storeManager, picker, skillName } = params;

  // So a mistyped skill is refused before it costs a pick.
  storeManager.requireSkillPath(skillName);

  const result = await pickChoices({
    picker,
    message: `Select the workspaces to unlink ${skillName} from`,
    choices: storeManager
      .listRegisteredWorkspaces()
      .map(({ name, path }) => ({ value: name, label: name, hint: path })),
    refusal: { noun: 'workspace', remedy: 'use --all-workspaces, or name them after --drop' },
  });
  const resultKind = result.kind;

  switch (resultKind) {
    case 'picked':
      return result.values;

    case 'no-choices':
      console.log('nothing to unlink: no workspace is registered');
      return undefined;

    case 'none-picked':
      console.log('nothing to unlink: no workspace selected');
      return undefined;

    default:
      return assertUnreachable(resultKind);
  }
}

// ----------------------------------------------------------------------------
// REPORTS
// ----------------------------------------------------------------------------

function reportLinks(
  result: ReturnType<LinkSkillUseCase>,
  options: { autoLinkExpected: boolean },
): void {
  const { linked, alreadyLinked, declined } = result;

  const linkedCount = linked.length + alreadyLinked.length;
  if (options.autoLinkExpected && linkedCount === 0) {
    console.log('nothing to link: no auto-link workspace is registered');
    return;
  }

  for (const { skill, workspace } of linked) {
    console.log(`linked ${skill} → ${workspace}`);
  }

  for (const { skill, workspace } of alreadyLinked) {
    console.log(`already linked ${skill} → ${workspace}`);
  }

  for (const refusal of declined) {
    console.warn(`warning: ${describeLinkRefusal(refusal)}`);
  }
}

function reportUnlinks(
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
