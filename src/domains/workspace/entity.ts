import { InvalidWorkspaceNameError } from '#src/lib/errors/index';
import { isResolvableDirectory } from '#src/lib/fs';

export type WorkspaceParams = {
  name: string;
  path: string;
  autoLink: boolean;
};

export class Workspace {
  readonly name: string;
  readonly path: string;
  readonly autoLink: boolean;

  constructor(params: WorkspaceParams) {
    if (!Workspace.isValidName(params.name)) {
      throw new InvalidWorkspaceNameError({ name: params.name });
    }

    this.name = params.name;
    this.path = params.path;
    this.autoLink = params.autoLink;
  }

  /**
   * Whether `name` can be registered: ASCII letters, digits, `-` and `_`,
   * starting with a letter or digit. `unclone` reads any target failing this
   * as a path, so no registered name can be mistaken for one.
   */
  static isValidName(name: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
  }

  /** Whether the path resolves to a directory. Gone, under a file, or a symlink cycle answers false. */
  isReachable(): boolean {
    return isResolvableDirectory(this.path);
  }
}
