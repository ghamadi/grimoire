import type { DirectoryAccess } from '@/lib/fs';
import { GrimoireError } from '@/lib/errors/grimoire-error';

export type UnreadableWorkspace = {
  name: string;
  path: string;
  access: Exclude<DirectoryAccess, 'accessible'>;
};

export type WorkspaceUnreadableErrorProps = {
  workspaces: UnreadableWorkspace[];
};

/**
 * Used when a skill removal meets a registered workspace whose path no longer
 * resolves or cannot be read.
 *
 * A link inside it could not be seen to clear, so the whole run refuses rather
 * than strand one. Every unreadable workspace is named, and the remedy line
 * follows the first: fixing or unregistering it is the next step either way.
 */
export class WorkspaceUnreadableError extends GrimoireError {
  readonly workspaces: UnreadableWorkspace[];

  constructor(props: WorkspaceUnreadableErrorProps) {
    const { workspaces } = props;
    const [first] = workspaces;

    super(
      [
        'cannot remove a skill while a workspace is unreadable',
        ...workspaces.map(
          ({ name, path, access }) =>
            `  ${name}: ${path} ${access === 'unresolvable' ? 'does not resolve' : 'cannot be read'}`,
        ),
        ...(first ? [`  ${describeRemedy(first)}`] : []),
      ].join('\n'),
    );

    this.name = 'WorkspaceUnreadableError';
    this.workspaces = workspaces;
  }
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

function describeRemedy(workspace: UnreadableWorkspace): string {
  const command = `grimoire workspaces remove ${workspace.name}`;

  return workspace.access === 'unresolvable'
    ? `make it readable, or unregister it with \`${command}\``
    : `make it readable, or unregister it anyway with \`${command} --force\``;
}
