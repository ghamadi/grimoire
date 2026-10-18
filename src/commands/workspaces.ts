import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import type { Workspace } from '@/domains/workspace';
import { createAddWorkspaceUseCase } from '@/use-cases/add-workspace-use-case/factory';
import { createListWorkspacesUseCase } from '@/use-cases/list-workspaces-use-case/factory';
import {
  createRemoveWorkspaceUseCase,
  type RemoveWorkspaceResult,
} from '@/use-cases/remove-workspace-use-case/factory';

export type WorkspacesCommandParams = {
  storeManager: GrimoireStoreManager;
};

/**
 * The `workspaces` command group: argv in, stdout out.
 *
 * Everything this file does beyond calling a domain function is formatting.
 * The aliases are commander's own, so `rm` and `ls` reach the same action
 * rather than a second definition that can drift.
 */
export function workspacesCommand(params: WorkspacesCommandParams): Command {
  const { storeManager } = params;
  const addWorkspace = createAddWorkspaceUseCase({ storeManager });
  const listWorkspaces = createListWorkspacesUseCase({ storeManager });
  const removeWorkspace = createRemoveWorkspaceUseCase({ storeManager });

  const command = new Command('workspaces').description('Manage the workspaces grimoire deploys to');

  command
    .command('add')
    .description('Register a workspace')
    .argument('<name>', 'name to register it under')
    .argument('<path>', 'directory skills are deployed into')
    .option('--auto-link', 'link every skill in the store into this workspace')
    .action((name: string, path: string, options: { autoLink?: boolean }) => {
      const { workspace: added, created } = addWorkspace({
        name,
        path,
        autoLink: options.autoLink,
      });

      // A directory grimoire made is a result, not a warning, so it goes to
      // stdout — on its own line, leaving the confirmation byte-identical to
      // the case where the directory was already there.
      if (created) {
        console.log(`created ${added.path}`);
      }

      console.log(
        `registered workspace "${added.name}" → ${added.path} (${describeAutoLink(added.autoLink)})`,
      );
    });

  command
    .command('remove')
    .alias('rm')
    .description('Unregister a workspace, leaving its directory alone')
    .argument('<name>', 'registered name')
    .option('--hard', 'clear the links and forget the clone records still pointing at it')
    .option('--force', 'unregister even when its directory cannot be read')
    .action((name: string, options: { hard?: boolean; force?: boolean }) => {
      const result = removeWorkspace({ name, hard: options.hard, force: options.force });
      const { workspace: removed, forgottenClones, linksUnchecked } = result;

      for (const line of describeChanges(result)) {
        console.log(line);
      }

      console.log(`unregistered workspace "${removed.name}" → ${removed.path}`);

      // A notice to convey that clones are now the user's responsibility.
      // We filter out the ones that don't exist on disk (regardless of whether they were still registered)
      if (forgottenClones.some((skill) => existsSync(join(removed.path, skill)))) {
        console.log('cloned directories were left in place');
      }

      if (linksUnchecked) {
        console.log(`links in ${removed.path} could not be checked and were left in place`);
      }
    });

  command
    .command('rename')
    .description('Rename a registered workspace, keeping its path and clone records')
    .argument('<name>', 'registered name')
    .argument('<new-name>', 'name to file it under instead')
    .action((name: string, newName: string) => {
      const { workspace, renamed } = storeManager.renameWorkspace({ name, newName });

      console.log(
        renamed
          ? `renamed workspace "${name}" → "${workspace.name}"`
          : `nothing to rename: workspace "${workspace.name}" already has that name`,
      );
    });

  command
    .command('list')
    .alias('ls')
    .description('List the registered workspaces')
    .action(() => {
      const workspaces = listWorkspaces();

      // A command that succeeded and said nothing is indistinguishable from one
      // that broke.
      if (workspaces.length === 0) {
        console.log('No workspaces registered.');
        return;
      }

      for (const line of formatWorkspaceTable(workspaces)) {
        console.log(line);
      }
    });

  return command;
}

/** `list` has no header row, so the column has to describe itself. */
const autoLinkLabels = { on: 'auto-link', off: 'manual' } as const;

function describeAutoLink(autoLink: boolean): string {
  return autoLink ? autoLinkLabels.on : autoLinkLabels.off;
}

function describeChanges(result: RemoveWorkspaceResult): string[] {
  const { clearedLinks, forgottenClones, convertedClones } = result;
  const lines: string[] = [];

  if (clearedLinks.length > 0) {
    lines.push(`removed ${count(clearedLinks.length, 'link')}: ${clearedLinks.join(', ')}`);
  }

  if (forgottenClones.length > 0) {
    lines.push(`forgot ${count(forgottenClones.length, 'clone record')}: ${forgottenClones.join(', ')}`);
  }

  if (convertedClones.length > 0) {
    lines.push(
      `${count(convertedClones.length, 'clone')} now recorded by path: ${convertedClones.join(', ')}`,
    );
  }

  return lines;
}

function count(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? '' : 's'}`;
}

/** The only unbounded-width column goes last, so nothing has to be padded to fit it. */
function formatWorkspaceTable(workspaces: Workspace[]): string[] {
  const nameWidth = Math.max(...workspaces.map(({ name }) => name.length));
  const autoLinkWidth = Math.max(...Object.values(autoLinkLabels).map((label) => label.length));

  return workspaces.map(
    ({ name, autoLink, path }) =>
      `${name.padEnd(nameWidth)}  ${describeAutoLink(autoLink).padEnd(autoLinkWidth)}  ${path}`,
  );
}
