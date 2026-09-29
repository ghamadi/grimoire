import { GrimoireError } from './grimoire-error.ts';

export type InvalidWorkspaceNameErrorProps = {
  name: string;
};

/**
 * A workspace name fails `Workspace.isValidName`.
 *
 * The offending name is `entryName`, not `name`: `Error.name` is the class
 * name, and every subclass here sets it.
 */
export class InvalidWorkspaceNameError extends GrimoireError {
  readonly entryName: string;

  constructor(props: InvalidWorkspaceNameErrorProps) {
    const { name } = props;
    super(
      `workspace name "${name}" must start with a letter or digit and contain only letters, digits, "-" and "_"`,
    );

    this.name = 'InvalidWorkspaceNameError';
    this.entryName = name;
  }
}
