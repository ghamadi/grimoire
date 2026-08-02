import { Command } from 'commander';
import { repoCommand } from '#src/commands/repo';
import { workspaceCommand } from '#src/commands/workspace';
import { getVersion } from '#src/lib/utils';
import type { GrimoireStore } from '#src/store/index';

/**
 * Assembles the CLI and hands it back unparsed.
 *
 * The store arrives as an argument and parsing stays with the caller, which is
 * what lets a test drive the whole surface in process without executing against
 * the real `process.argv` and the real `$HOME`.
 */
export function buildProgram(store: GrimoireStore): Command {
  const program = new Command();

  program
    .name('grimoire')
    .description('Authoring and distribution for agent skills')
    .version(getVersion())
    .addCommand(repoCommand(store))
    .addCommand(workspaceCommand(store));

  return program;
}
