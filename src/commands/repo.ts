import { Command, Option } from 'commander';
import {
  DEFAULT_REPO_MODE,
  addRepo,
  listRepos,
  removeRepo,
  repoModes,
  type Repo,
  type RepoMode,
  type RepoWarning,
} from '#src/repo/index';
import type { GrimoireStore } from '#src/store/index';

/**
 * The `repo` command group: argv in, stdout out.
 *
 * Everything this file does beyond calling a domain function is formatting.
 * The aliases are commander's own, so `rm` and `ls` reach the same action
 * rather than a second definition that can drift.
 */
export function repoCommand(store: GrimoireStore): Command {
  const repo = new Command('repo').description('Manage the skill repos grimoire exchanges with');

  repo
    .command('add')
    .description('Register a repo')
    .argument('<name>', 'name to register it under')
    .argument('<path>', 'directory the skills live under')
    .addOption(
      new Option('--mode <mode>', 'access mode').choices([...repoModes]).default(DEFAULT_REPO_MODE),
    )
    .action((name: string, path: string, options: { mode: RepoMode }) => {
      const { repo: added, warning } = addRepo(store, { name, path, mode: options.mode });

      if (warning) {
        console.error(`warning: ${describeWarning(warning)}`);
      }

      console.log(`registered repo "${added.name}" → ${added.path} (${added.mode})`);
    });

  repo
    .command('remove')
    .alias('rm')
    .description('Unregister a repo, leaving its directory alone')
    .argument('<name>', 'registered name')
    .action((name: string) => {
      const removed = removeRepo(store, name);

      console.log(`unregistered repo "${removed.name}" → ${removed.path}`);
    });

  repo
    .command('list')
    .alias('ls')
    .description('List the registered repos')
    .action(() => {
      const repos = listRepos(store);

      // A command that succeeded and said nothing is indistinguishable from one
      // that broke.
      if (repos.length === 0) {
        console.log('No repos registered.');
        return;
      }

      for (const line of formatRepoTable(repos)) {
        console.log(line);
      }
    });

  return repo;
}

function describeWarning(warning: RepoWarning): string {
  return `no .git found at or above ${warning.path}`;
}

/** The only unbounded-width column goes last, so nothing has to be padded to fit it. */
function formatRepoTable(repos: Repo[]): string[] {
  const nameWidth = Math.max(...repos.map(({ name }) => name.length));
  const modeWidth = Math.max(...repoModes.map((mode) => mode.length));

  return repos.map(
    ({ name, mode, path }) => `${name.padEnd(nameWidth)}  ${mode.padEnd(modeWidth)}  ${path}`,
  );
}
