import { styleText } from 'node:util';
import { Command } from 'commander';
import { cloneCommand } from '@/commands/clone';
import { exportCommand } from '@/commands/export';
import { linkCommand } from '@/commands/link';
import { reposCommand } from '@/commands/repos';
import { clackSkillPicker, skillsCommand, type SkillPicker } from '@/commands/skills';
import { statusCommand } from '@/commands/status';
import type { TextStyler } from '@/lib/text-styler';
import { trashCommand } from '@/commands/trash';
import { uncloneCommand } from '@/commands/unclone';
import { unlinkCommand } from '@/commands/unlink';
import { workspacesCommand } from '@/commands/workspaces';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store';
import { getVersion } from '@/lib/utils';

export type ProgramDependencies = {
  skillPicker?: SkillPicker;
  textStyler?: TextStyler;
  getTerminalWidth?: () => number | undefined;
};

/**
 * Assembles the CLI and hands it back unparsed.
 *
 * The store arrives as an argument and parsing stays with the caller, which is
 * what lets a test drive the whole surface in process without executing against
 * the real `process.argv` and the real `$HOME`.
 */
export function buildProgram(store: GrimoireStore, dependencies: ProgramDependencies = {}): Command {
  const {
    skillPicker = clackSkillPicker,
    textStyler = styleText,
    getTerminalWidth = getStdoutTerminalWidth,
  } = dependencies;
  const program = new Command();
  const storeManager = new GrimoireStoreManager(store);

  program
    .name('grimoire')
    .description('Authoring and distribution for agent skills')
    .version(getVersion())
    .addCommand(workspacesCommand({ storeManager }))
    .addCommand(reposCommand({ storeManager }))
    .addCommand(exportCommand({ storeManager }))
    .addCommand(skillsCommand({ storeManager, skillPicker }))
    .addCommand(linkCommand({ storeManager }))
    .addCommand(unlinkCommand({ storeManager }))
    .addCommand(cloneCommand({ storeManager }))
    .addCommand(uncloneCommand({ storeManager }))
    .addCommand(trashCommand({ storeManager, textStyler }))
    .addCommand(statusCommand({ storeManager, textStyler, getTerminalWidth }));

  return program;
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function getStdoutTerminalWidth(): number | undefined {
  return process.stdout.isTTY ? process.stdout.columns : undefined;
}
