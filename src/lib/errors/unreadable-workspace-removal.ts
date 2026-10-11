import { GrimoireError } from '@/lib/errors/grimoire-error';

export type UnreadableWorkspaceRemovalErrorProps = {
  name: string;
  path: string;
  hard: boolean;
};

/**
 * Used when `workspaces remove` meets a registered workspace whose directory
 * cannot be read, and `--force` was not given.
 *
 * Links inside it cannot be seen, so unregistering would strand them. `--force`
 * is the escape, and `hard` is carried so the suggested command repeats
 * `--hard` when the refused run had it. Otherwise following the fix would
 * convert clone records the run meant to forget.
 *
 * Named apart from `WorkspaceUnreadableError`, which is `skills remove`'s
 * refusal. The offending name is `entryName`, matching `WorkspaceInUseError`.
 */
export class UnreadableWorkspaceRemovalError extends GrimoireError {
  readonly entryName: string;
  readonly path: string;
  readonly hard: boolean;

  constructor(props: UnreadableWorkspaceRemovalErrorProps) {
    const { name, path, hard } = props;
    const command = `grimoire workspaces remove ${name}${hard ? ' --hard' : ''} --force`;

    super(
      [
        `cannot remove workspace "${name}": ${path} cannot be read`,
        `  make it readable, then run this again, or unregister it anyway with \`${command}\``,
      ].join('\n'),
    );

    this.name = 'UnreadableWorkspaceRemovalError';
    this.entryName = name;
    this.path = path;
    this.hard = hard;
  }
}
