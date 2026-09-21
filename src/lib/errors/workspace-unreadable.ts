import { GrimoireError } from './grimoire-error.ts';

export type UnreadableWorkspace = {
  name: string;
  path: string;
};

export type WorkspaceUnreadableErrorProps = {
  workspaces: UnreadableWorkspace[];
};

/**
 * Used when a skill removal meets a registered workspace whose path no longer
 * resolves.
 *
 * A link inside it could not be seen to clear, so the whole run refuses rather
 * than strand one. Every unreadable workspace is named, and the remedy line
 * names the first: fixing or unregistering it is the next step either way.
 */
export class WorkspaceUnreadableError extends GrimoireError {
  readonly workspaces: UnreadableWorkspace[];

  constructor(props: WorkspaceUnreadableErrorProps) {
    const { workspaces } = props;
    const [first] = workspaces;

    super(
      [
        'cannot remove a skill while a workspace is unreadable',
        ...workspaces.map(({ name, path }) => `  ${name}: ${path} does not resolve`),
        ...(first
          ? [`  make it readable, or unregister it with \`grimoire workspaces remove ${first.name}\``]
          : []),
      ].join('\n'),
    );

    this.name = 'WorkspaceUnreadableError';
    this.workspaces = workspaces;
  }
}
