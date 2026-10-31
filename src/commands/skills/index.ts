import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { findSkillSources, type SkillSource } from '@/domains/skill';
import { packSkills } from '@/commands/skills/helpers/pack';
import {
  describeAddRefusal,
  describeLinkRefusal,
  LinkDeclinedError,
  NoTerminalError,
} from '@/lib/errors';
import { assertUsableDirectory } from '@/lib/directories';
import { cloneRepo, getUrlWithoutCredentials } from '@/lib/git';
import { formatMissingArgument } from '@/lib/missing-argument';
import { normalizePath } from '@/lib/paths';
import type { Picker } from '@/lib/picker';
import { withTempDirectory } from '@/lib/temp-directory';
import {
  createAddSkillsUseCase,
  type AddSkillsReport,
  type AddSkillsUseCase,
} from '@/use-cases/add-skills-use-case/factory';
import {
  createLinkSkillUseCase,
  type LinkSkillReport,
  type LinkSkillUseCase,
} from '@/use-cases/link-skill-use-case/factory';
import {
  createRemoveSkillsUseCase,
  type RemovedSkill,
} from '@/use-cases/remove-skills-use-case/factory';

export type SkillsCommandParams = {
  storeManager: GrimoireStoreManager;
  picker: Picker;
};

// ----------------------------------------------------------------------------
// THE COMMAND
// ----------------------------------------------------------------------------

/**
 * The `skills` command group: argv in, stdout out.
 */
export function skillsCommand(params: SkillsCommandParams): Command {
  const { storeManager, picker } = params;
  const addSkills = createAddSkillsUseCase({ storeManager });
  const linkSkill = createLinkSkillUseCase({ storeManager });
  const removeSkills = createRemoveSkillsUseCase({ storeManager });

  const command = new Command('skills').description('Manage the skills in the grimoire store');

  command
    .command('add')
    .description('Add a skill, or a directory of skills, to the store')
    .argument('<source>', 'a skill directory, a directory to search under for skills, or a git URL')
    .option('--all', 'add every skill found under <source>')
    .action(async (source: string, options: { all?: boolean }) => {
      const all = options.all ?? false;
      const mustRefuse = !all && !picker.isInteractive();
      const addFrom = (params: { location: string; sources: SkillSource[] }) =>
        addSources({ ...params, all, picker, addSkills, linkSkill });

      if (!isRemoteSource(source)) {
        const path = normalizePath(source);
        storeManager.assertOutsideStore(path);
        assertUsableDirectory(path);

        if (mustRefuse) {
          throw new NoTerminalError({ location: path });
        }

        await addFrom({ location: path, sources: findSkillSources({ path }) });
        return;
      }

      const displayUrl = getUrlWithoutCredentials(source);

      if (mustRefuse) {
        throw new NoTerminalError({ location: displayUrl });
      }

      console.error(`cloning ${displayUrl}…`);

      await withTempDirectory(async (directory) => {
        const repoPath = cloneRepo({ url: source, directory });
        // Without this, a repo that is itself a skill brings its git database, origin URL included, into the store.
        rmSync(join(repoPath, '.git'), { recursive: true, force: true });

        await addFrom({
          location: displayUrl,
          sources: findSkillSources({ path: repoPath, repoUrl: displayUrl }),
        });
      });
    });

  command
    .command('list')
    .alias('ls')
    .description('List the skills the store holds')
    .action(() => logSkillNames(storeManager.listSkillNames()));

  command
    .command('pack')
    .description('Write store skills as zips into a folder')
    .argument('[skills...]', 'store skills to pack, unless --all')
    .option('--all', 'pack every skill the store holds')
    .option('--out <directory>', 'the folder to write the zips into (default: the current folder)')
    .action((skills: string[], options: { all?: boolean; out?: string }, packCommand: Command) => {
      const { all, out } = options;

      if (skills.length > 0 && all) {
        packCommand.error('error: --all cannot be combined with named skills');
      }

      if (skills.length === 0 && !all) {
        packCommand.error(formatMissingArgument({ name: 'skills', allFlag: '--all' }));
      }

      const skillNames = all ? storeManager.listSkillNames() : skills;

      if (skillNames.length === 0) {
        console.log('nothing to pack: the store holds no skills');
        return;
      }

      packSkills({ storeManager, skillNames, outPath: out ?? '.' });
    });

  command
    .command('path')
    .description('Print the path of a store skill, or of the store')
    .argument('[skill]', 'a skill name in the store')
    .action((skillName: string | undefined) =>
      console.log(
        skillName === undefined
          ? storeManager.skillsDirectory()
          : storeManager.requireSkillPath(skillName, { requireSkillDirectory: true }),
      ),
    );

  command
    .command('remove')
    .alias('rm')
    .description('Remove a skill from the store')
    .argument('<skills...>', 'skill names in the store')
    .option('--forget-clones', 'forget the clone records, leaving every cloned directory where it is')
    .action((skillNames: string[], options: { forgetClones?: boolean }) =>
      logRemoveReport(removeSkills({ skillNames, forgetClones: options.forgetClones })),
    );

  return command;
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function isRemoteSource(source: string): boolean {
  return /^(?:https:\/\/|ssh:\/\/|git@[^/:]+:)/.test(source);
}

/** `location` names the crawled source in messages: a path, or the URL a clone was made from. */
async function addSources(params: {
  location: string;
  sources: SkillSource[];
  all: boolean;
  picker: Picker;
  addSkills: AddSkillsUseCase;
  linkSkill: LinkSkillUseCase;
}): Promise<void> {
  const { location, sources, all, picker, addSkills, linkSkill } = params;

  if (sources.length === 0) {
    console.log(`nothing to add: no skill found under ${location}`);
    return;
  }

  let selected = sources;

  if (!all) {
    const picked = await picker.pick({
      message: 'Select the skills to add',
      choices: sources.map((source) => ({ value: source, label: source.name, hint: source.location })),
    });
    selected = inSourceOrder({ sources, picked });
  }

  if (selected.length === 0) {
    console.log('nothing to add: no skill selected');
    return;
  }

  const add = addSkills({ sources: selected });
  const link = autoLink({
    linkSkill,
    skillNames: linkableSkills({ sources: selected, added: add }),
  });

  logAddReport(add);
  logLinkReport(link);
}

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
  for (const { skill, binPath, clearedLinks, forgottenClones, keptClones } of removals) {
    for (const { workspace, filedAs } of clearedLinks) {
      console.log(`unlinked ${skill} → ${workspace}${filedAs ? ` (entry "${filedAs}")` : ''}`);
    }

    console.log(`trashed ${skill} → ${binPath}`);

    for (const origin of forgottenClones) {
      console.log(`forgot clone ${skill} → ${origin}`);
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
