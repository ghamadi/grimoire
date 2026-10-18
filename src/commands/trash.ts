import { Command } from 'commander';
import type { TextStyler } from '@/lib/text-styler';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';

export type TrashCommandParams = {
  storeManager: GrimoireStoreManager;
  textStyler: TextStyler;
};

export function trashCommand(params: TrashCommandParams): Command {
  const { storeManager, textStyler } = params;

  const command = new Command('trash').description('Manage the trash that removed skills are moved to');

  command
    .command('empty')
    .description('Permanently delete everything in the trash')
    .action(() => {
      const deletedPaths = storeManager.emptyTrash();

      for (const line of formatEmptiedTrash({ deletedPaths, textStyler })) {
        console.log(line);
      }
    });

  return command;
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function formatEmptiedTrash(params: { deletedPaths: string[]; textStyler: TextStyler }): string[] {
  const { deletedPaths, textStyler } = params;

  if (deletedPaths.length === 0) {
    return [textStyler('dim', 'nothing to delete: the trash is empty')];
  }

  const binCount = deletedPaths.length === 1 ? '1 bin' : `${deletedPaths.length} bins`;

  return [
    ...deletedPaths.map((path) => `${textStyler('red', 'deleted')} ${path}`),
    textStyler('bold', `emptied the trash: ${binCount}`),
  ];
}
