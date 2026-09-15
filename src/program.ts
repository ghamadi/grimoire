import { Command } from 'commander';
import { linkCommand } from '#src/commands/link';
import { unlinkCommand } from '#src/commands/unlink';
import { workspaceCommand } from '#src/commands/workspace';
import { GrimoireStore, GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { getVersion } from '#src/lib/utils';

/**
 * Assembles the CLI and hands it back unparsed.
 *
 * The store arrives as an argument and parsing stays with the caller, which is
 * what lets a test drive the whole surface in process without executing against
 * the real `process.argv` and the real `$HOME`.
 */
export function buildProgram(store: GrimoireStore): Command {
  const program = new Command();
  const storeManager = new GrimoireStoreManager(store);

  program
    .name('grimoire')
    .description('Authoring and distribution for agent skills')
    .version(getVersion())
    .addCommand(workspaceCommand({ storeManager }))
    .addCommand(linkCommand({ storeManager }))
    .addCommand(unlinkCommand({ storeManager }));

  return program;
}
