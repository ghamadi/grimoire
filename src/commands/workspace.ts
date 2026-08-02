import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { describeCollision } from '#src/lib/errors/index';
import type { GrimoireStore } from '#src/store/index';
import {
  addWorkspace,
  listWorkspaces,
  removeWorkspace,
  type Workspace,
  type WorkspaceRemoved,
} from '#src/workspace/index';

/**
 * The `workspace` command group: argv in, stdout out.
 *
 * Everything this file does beyond calling a domain function is formatting.
 * The aliases are commander's own, so `rm` and `ls` reach the same action
 * rather than a second definition that can drift.
 */
export function workspaceCommand(store: GrimoireStore): Command {
  const workspace = new Command('workspace').description('Manage the workspaces grimoire deploys to');

  workspace
    .command('add')
    .description('Register a workspace')
    .argument('<name>', 'name to register it under')
    .argument('<path>', 'directory skills are deployed into')
    .option('--auto-link', 'link every skill in the store into this workspace')
    .action((name: string, path: string, options: { autoLink?: boolean }) => {
      const { workspace: added, created } = addWorkspace(store, {
        name,
        path,
        autoLink: options.autoLink,
      });

      // A directory grimoire made is a result, not a warning, so it goes to
      // stdout — on its own line, leaving the confirmation byte-identical to
      // the case where the directory was already there.
      if (created) {
        console.log(`created ${created}`);
      }

      console.log(
        `registered workspace "${added.name}" → ${added.path} (${describeAutoLink(added.autoLink)})`,
      );
    });

  workspace
    .command('remove')
    .alias('rm')
    .description('Unregister a workspace, leaving its directory alone')
    .argument('<name>', 'registered name')
    .option('--hard', 'clear the links and forget the clone records still pointing at it')
    .action((name: string, options: { hard?: boolean }) => {
      const result = removeWorkspace(store, { name, hard: options.hard });
      const { workspace: removed, cleared, collision } = result;

      if (collision) {
        console.error(
          `warning: ${describeCollision({ path: removed.path, collision })} — no links were cleared from it`,
        );
      }

      for (const line of describeChanges(result)) {
        console.log(line);
      }

      console.log(`unregistered workspace "${removed.name}" → ${removed.path}`);

      // A notice to convey that clones are now the user's responsibility.
      // We filter out the ones that don't exist on disk (regardless of whether they were still registered)
      if (cleared.clones.some((skill) => existsSync(join(removed.path, skill)))) {
        console.log('cloned directories were left in place');
      }
    });

  workspace
    .command('list')
    .alias('ls')
    .description('List the registered workspaces')
    .action(() => {
      const workspaces = listWorkspaces(store);

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

  return workspace;
}

/** `list` has no header row, so the column has to describe itself. */
const autoLinkLabels = { on: 'auto-link', off: 'manual' } as const;

function describeAutoLink(autoLink: boolean): string {
  return autoLink ? autoLinkLabels.on : autoLinkLabels.off;
}

function describeChanges({ cleared, converted }: WorkspaceRemoved): string[] {
  const lines: string[] = [];

  if (cleared.links.length > 0) {
    lines.push(`removed ${count(cleared.links.length, 'link')}: ${cleared.links.join(', ')}`);
  }

  if (cleared.clones.length > 0) {
    lines.push(`forgot ${count(cleared.clones.length, 'clone record')}: ${cleared.clones.join(', ')}`);
  }

  if (converted.length > 0) {
    lines.push(`${count(converted.length, 'clone')} now recorded by path: ${converted.join(', ')}`);
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
