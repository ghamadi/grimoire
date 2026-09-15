import { Command } from 'commander';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { describeLinkRefusal } from '#src/lib/errors/index';
import {
  createLinkSkillUseCase,
  type LinkSkillUseCase,
} from '#src/use-cases/link-skill-use-case/factory';

export type LinkCommandParams = {
  storeManager: GrimoireStoreManager;
};

export function linkCommand(params: LinkCommandParams): Command {
  const { storeManager } = params;
  const linkSkill = createLinkSkillUseCase({ storeManager });

  const link = new Command('link')
    .description('Symlink store skills into workspaces')
    .argument('[skill]', 'skill to link, unless --all-skills')
    .argument('[workspaces...]', 'registered names (default: every auto-link workspace)')
    .option('--all-skills', 'link every skill the store holds')
    .action((skill: string | undefined, workspaces: string[], options: { allSkills?: boolean }) => {
      const parsedArguments = parseArguments({
        skill,
        workspaces,
        allSkills: options.allSkills ?? false,
        refuse: (message) => link.error(message),
      });

      const skillNames = parsedArguments.allSkills
        ? storeManager.listSkillNames()
        : [parsedArguments.skillName];

      if (skillNames.length === 0) {
        console.log('nothing to link: the store holds no skills');
        return;
      }

      report(linkSkill({ skillNames, workspaces: parsedArguments.workspaces }), {
        autoLinkExpected: parsedArguments.workspaces === undefined,
      });
    });

  return link;
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function report(result: ReturnType<LinkSkillUseCase>, options: { autoLinkExpected: boolean }): void {
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

type ParseArgumentsParams = {
  skill: string | undefined;
  workspaces: string[];
  allSkills: boolean;
  refuse: (message: string) => never;
};

type ParsedArguments =
  | { allSkills: true; skillName: undefined; workspaces: string[] | undefined }
  | { allSkills: false; skillName: string; workspaces: string[] | undefined };

/**
 * The raw commander arguments, in the shape the use case takes.
 */
function parseArguments(params: ParseArgumentsParams): ParsedArguments {
  const { skill, workspaces, allSkills, refuse } = params;

  if (allSkills) {
    const workspacesClone = [...workspaces];

    // `--all-skills` leaves no skill argument, so what commander parsed as
    // `skill` is the first workspace.
    if (skill) {
      workspacesClone.push(skill);
    }

    return {
      allSkills: true,
      skillName: undefined,
      workspaces: workspacesClone.length ? workspacesClone : undefined,
    };
  }

  if (!skill) {
    return refuse("error: missing required argument 'skill' (or use --all-skills)");
  }

  return {
    allSkills: false,
    skillName: skill,
    workspaces: workspaces.length ? workspaces : undefined,
  };
}
