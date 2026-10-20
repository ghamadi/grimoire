import { join } from 'node:path';
import { InvalidNameError } from '@/lib/errors';
import { getDirectoryAccess, STAGING_DIRECTORY_NAME, type DirectoryAccess } from '@/lib/fs';

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
      throw new InvalidNameError({ entity: 'workspace', name: params.name });
    }

    this.name = params.name;
    this.path = params.path;
    this.autoLink = params.autoLink;
  }

  /**
   * Whether `name` can be registered: ASCII letters, digits, `-` and `_`,
   * starting with a letter or digit. `clone --drop` reads any target failing
   * this as a path, so no registered name can be mistaken for one.
   */
  static isValidName(name: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
  }

  /** Where a clone is built before it replaces anything in the workspace. */
  get stagingDirectory(): string {
    return join(this.path, STAGING_DIRECTORY_NAME);
  }

  /** How far grimoire can get into the workspace's directory — see {@link getDirectoryAccess}. */
  getDirectoryAccess(): DirectoryAccess {
    return getDirectoryAccess(this.path);
  }
}
