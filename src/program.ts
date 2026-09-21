import { Command } from 'commander';
import { clackSkillPicker, type SkillPicker } from '#src/commands/prompts/skill-picker';
import { linkCommand } from '#src/commands/link';
import { skillsCommand } from '#src/commands/skills';
import { unlinkCommand } from '#src/commands/unlink';
import { workspacesCommand } from '#src/commands/workspaces';
import { GrimoireStore, GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { getVersion } from '#src/lib/utils';

export type ProgramDependencies = { skillPicker?: SkillPicker };

/**
 * Assembles the CLI and hands it back unparsed.
 *
 * The store arrives as an argument and parsing stays with the caller, which is
 * what lets a test drive the whole surface in process without executing against
 * the real `process.argv` and the real `$HOME`.
 */
export function buildProgram(store: GrimoireStore, dependencies: ProgramDependencies = {}): Command {
  const { skillPicker = clackSkillPicker } = dependencies;
  const program = new Command();
  const storeManager = new GrimoireStoreManager(store);

  program
    .name('grimoire')
    .description('Authoring and distribution for agent skills')
    .version(getVersion())
    .addCommand(workspacesCommand({ storeManager }))
    .addCommand(skillsCommand({ storeManager, skillPicker }))
    .addCommand(linkCommand({ storeManager }))
    .addCommand(unlinkCommand({ storeManager }));

  return program;
}
