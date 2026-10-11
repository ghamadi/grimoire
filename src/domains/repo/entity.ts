import { join } from 'node:path';
import { Workspace } from '@/domains/workspace/index';
import { InvalidNameError } from '@/lib/errors/index';
import { STAGING_DIRECTORY_NAME } from '@/lib/fs';

export type RepoParams = {
  name: string;
  path: string;
};

export class Repo {
  readonly name: string;
  readonly path: string;

  constructor(params: RepoParams) {
    if (!Repo.isValidName(params.name)) {
      throw new InvalidNameError({ entity: 'repo', name: params.name });
    }

    this.name = params.name;
    this.path = params.path;
  }

  /** Whether `name` can be registered — the same rule as {@link Workspace.isValidName}. */
  static isValidName(name: string): boolean {
    return Workspace.isValidName(name);
  }

  /** Where an export is built before it replaces anything in the repo. */
  get stagingDirectory(): string {
    return join(this.path, STAGING_DIRECTORY_NAME);
  }
}
