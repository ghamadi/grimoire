import { Command } from 'commander';
import type { SkillPicker } from '#src/commands/prompts/skill-picker';
import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { findSkillSources, type SkillSource } from '#src/domains/skill/index';
import {
  describeAddRefusal,
  describeLinkRefusal,
  LinkDeclinedError,
  NoTerminalError,
} from '#src/lib/errors/index';
import { normalizePath } from '#src/lib/paths';
import {
  createAddSkillsUseCase,
  type AddSkillsReport,
} from '#src/use-cases/add-skills-use-case/factory';
import {
  createLinkSkillUseCase,
  type LinkSkillReport,
  type LinkSkillUseCase,
} from '#src/use-cases/link-skill-use-case/factory';
import {
  createRemoveSkillsUseCase,
  type RemovedSkill,
} from '#src/use-cases/remove-skills-use-case/factory';

export type SkillsCommandParams = {
  storeManager: GrimoireStoreManager;
  skillPicker: SkillPicker;
};

// ----------------------------------------------------------------------------
// THE COMMAND
// ----------------------------------------------------------------------------

/**
 * The `skills` command group: argv in, stdout out.
 */
export function skillsCommand(params: SkillsCommandParams): Command {
  const { storeManager, skillPicker } = params;
  const addSkills = createAddSkillsUseCase({ storeManager });
  const linkSkill = createLinkSkillUseCase({ storeManager });
  const removeSkills = createRemoveSkillsUseCase({ storeManager });

  const command = new Command('skills').description('Manage the skills in the grimoire store');

  command
    .command('add')
    .description('Add a skill, or a directory of skills, to the store')
    .argument('<path>', 'a skill directory, or a directory to search under for skills')
    .option('--all', 'add every skill found under <path>')
    .action(async (pathArgument: string, options: { all?: boolean }) => {
      const path = normalizePath(pathArgument);
      storeManager.assertOutsideStore(path);

      const sources = findSkillSources({ path });
      if (sources.length === 0) {
        console.log(`nothing to add: no skill found under ${path}`);
        return;
      }

      let selected = sources;

      if (!options.all) {
        if (!skillPicker.isInteractive()) {
          throw new NoTerminalError({ path, skillCount: sources.length });
        }

        selected = inSourceOrder({ sources, picked: await skillPicker.pick({ sources }) });
      }

      if (selected.length === 0) {
        console.log('nothing added: no skill selected');
        return;
      }

      const add = addSkills({ sources: selected });
      const link = autoLink({
        linkSkill,
        skillNames: linkableSkills({ sources: selected, added: add }),
      });

      logAddReport(add);
      logLinkReport(link);
    });

  command
    .command('list')
    .alias('ls')
    .description('List the skills the store holds')
    .action(() => logSkillNames(storeManager.listSkillNames()));

  command
    .command('remove')
    .alias('rm')
    .description('Remove a skill from the store')
    .argument('<skills...>', 'skill names in the store')
    .option('--remove-clones', 'also trash every cloned copy and forget its record')
    .action((skillNames: string[], options: { removeClones?: boolean }) =>
      logRemoveReport(removeSkills({ skillNames, removeClones: options.removeClones })),
    );

  return command;
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** The picked sources in the crawl's order, ignoring anything it did not offer. */
function inSourceOrder(params: { sources: SkillSource[]; picked: SkillSource[] }): SkillSource[] {
  const pickedPaths = new Set(params.picked.map((source) => source.path));
  return params.sources.filter((source) => pickedPaths.has(source.path));
}

/** Every skill this run put in the store or found already there, in source order. */
function linkableSkills(params: { sources: SkillSource[]; added: AddSkillsReport }): string[] {
  const names = new Set([...params.added.added, ...params.added.present].map(({ skill }) => skill));

  return params.sources.filter(({ name }) => names.has(name)).map(({ name }) => name);
}

function autoLink(params: { linkSkill: LinkSkillUseCase; skillNames: string[] }): LinkSkillReport {
  try {
    return params.linkSkill({ skillNames: params.skillNames });
  } catch (error) {
    if (error instanceof LinkDeclinedError) {
      return { linked: [], alreadyLinked: [], declined: error.refusals };
    }

    throw error;
  }
}

function logAddReport(add: AddSkillsReport): void {
  for (const { skill } of add.added) {
    console.log(`added ${skill}`);
  }

  for (const { skill, storeExtra } of add.present) {
    console.log(`already in the store: ${skill}${storeExtra ? ` (also holds "${storeExtra}")` : ''}`);
  }

  for (const refusal of add.declined) {
    console.warn(`warning: ${describeAddRefusal(refusal)}`);
  }
}

function logLinkReport(link: LinkSkillReport): void {
  for (const { skill, workspace } of link.linked) {
    console.log(`linked ${skill} → ${workspace}`);
  }

  for (const { skill, workspace } of link.alreadyLinked) {
    console.log(`already linked ${skill} → ${workspace}`);
  }

  for (const refusal of link.declined) {
    console.warn(`warning: ${describeLinkRefusal(refusal)}`);
  }
}

function logRemoveReport(removals: RemovedSkill[]): void {
  for (const { skill, binPath, clearedLinks, removedClones, keptClones } of removals) {
    for (const { workspace, filedAs } of clearedLinks) {
      console.log(`unlinked ${skill} → ${workspace}${filedAs ? ` (entry "${filedAs}")` : ''}`);
    }

    console.log(`trashed ${skill} → ${binPath}`);

    for (const origin of removedClones) {
      console.log(`removed clone ${skill} → ${origin}`);
    }

    for (const origin of keptClones) {
      console.log(`clones left in place: ${skill} → ${origin}`);
    }
  }
}

function logSkillNames(names: string[]): void {
  if (names.length === 0) {
    console.log('No skills in the store.');
    return;
  }

  for (const name of names) {
    console.log(name);
  }
}
