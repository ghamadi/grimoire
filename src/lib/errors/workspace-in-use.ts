import { GrimoireError } from './grimoire-error.ts';

export type WorkspaceInUseErrorProps = {
  name: string;
  links: string[];
};

/**
 * Used when a workspace still holds links and is being unregistered without `--hard`.
 *
 * Links are not recorded in the state, and they are by definition, managed by grimoire.
 * If a managed workspace is being unregistered while it's linking to grimoire's skills,
 * we end up with symlinks on the filesystem that grimoire is not aware of.
 *
 * The offending name is `entryName`, matching `DuplicateNameError`. The message
 * is multi-line because the acceptance criterion is that every stranded skill is
 * named, and a single line stops being readable at ten of them.
 */
export class WorkspaceInUseError extends GrimoireError {
  readonly entryName: string;
  readonly links: string[];

  constructor(props: WorkspaceInUseErrorProps) {
    const { name, links } = props;
    super(
      [
        `workspace "${name}" is still in use`,
        `  links: ${links.join(', ')}`,
        '  use --hard to clear them',
      ].join('\n'),
    );

    this.name = 'WorkspaceInUseError';
    this.entryName = name;
    this.links = links;
  }
}
