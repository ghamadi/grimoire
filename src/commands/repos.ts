import { Command } from 'commander';
import type { GrimoireStoreManager, RegisteredRepo } from '@/domains/grimoire-store/index';

export type ReposCommandParams = {
  storeManager: GrimoireStoreManager;
};

export function reposCommand(params: ReposCommandParams): Command {
  const { storeManager } = params;

  const command = new Command('repos').description('Manage the git repos grimoire exports skills to');

  command
    .command('add')
    .description('Register a repo')
    .argument('<name>', 'name to register it under')
    .argument('<path>', 'directory inside a git work tree that skills are exported into')
    .action((name: string, path: string) => {
      const added = storeManager.registerRepo({ name, path });

      console.log(`registered repo "${added.name}" → ${added.path}`);
    });

  command
    .command('remove')
    .alias('rm')
    .description('Unregister a repo, leaving its directory alone')
    .argument('<name>', 'registered name')
    .action((name: string) => {
      const removed = storeManager.unregisterRepo(name);

      console.log(`unregistered repo "${removed.name}" → ${removed.path}`);
    });

  command
    .command('list')
    .alias('ls')
    .description('List the registered repos')
    .action(() => {
      const repos = storeManager.listRegisteredRepos();

      if (repos.length === 0) {
        console.log('No repos registered.');
        return;
      }

      for (const line of formatRepoTable(repos)) {
        console.log(line);
      }
    });

  return command;
}

function formatRepoTable(repos: RegisteredRepo[]): string[] {
  const nameWidth = Math.max(...repos.map(({ name }) => name.length));

  return repos.map(({ name, path }) => `${name.padEnd(nameWidth)}  ${path}`);
}
