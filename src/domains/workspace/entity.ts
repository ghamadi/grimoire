import { InvalidPathError } from '../../lib/errors/index.ts';
import { tryStatSync } from '../../lib/fs.ts';

export type WorkspaceParams = {
  name: string;
  path: string;
  autoLink: boolean;
};

export type WorkspaceVerifyOptions = {
  throw?: boolean;
};

export class Workspace {
  readonly name: string;
  readonly path: string;
  readonly autoLink: boolean;

  constructor(params: WorkspaceParams) {
    this.name = params.name;
    this.path = params.path;
    this.autoLink = params.autoLink;
  }

  /**
   * Creates a workspace with a verified path.
   * @throws InvalidPathError if the path does not exist or is not a directory.
   */
  static createVerified(params: WorkspaceParams): Workspace {
    const workspace = new Workspace(params);
    workspace.verify({ throw: true });
    return workspace;
  }

  /**
   * Confirms that this workspace's path exists and is a directory.
   * When `throw` is true, fails with InvalidPathError; otherwise returns a boolean.
   *
   * TODO: Remove support for `throw` option. Always throw when validation fails.
   */
  verify(options?: WorkspaceVerifyOptions): boolean {
    const { throw: shouldThrow = false } = options ?? {};
    const path = this.path;

    const status = tryStatSync(path);
    let error: InvalidPathError | undefined;

    if (!status) {
      error = new InvalidPathError({ path, reason: 'missing' });
    } else if (!status.isDirectory()) {
      error = new InvalidPathError({ path, reason: 'not-a-directory' });
    }

    if (error && shouldThrow) {
      throw error;
    }

    return !error;
  }
}
