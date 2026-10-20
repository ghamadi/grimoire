import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Collision } from '@/lib/errors';
import { normalizePath, relate } from '@/lib/paths';

export const DEFAULT_HOME_DIRECTORY = '.grimoire';

type StorePaths = {
  root: string;
  skills: string;
  trash: string;
  backup: string;
  state: string;
};

/**
 * Where the store's files sit, and the one rule about what may sit near them.
 *
 * Every path is derived from the home it was handed rather than resolved a
 * second time, so a store built on a temp root cannot half-resolve to the real
 * `$HOME`. Reading and writing what those paths name belongs to
 * `GrimoireStoreManager`.
 */
export class GrimoireStore {
  readonly paths: StorePaths;

  constructor(homePath: string) {
    const home = normalizePath(homePath);

    this.paths = {
      root: home,
      skills: join(home, 'skills'),
      trash: join(home, '.trash'),
      backup: join(home, '.backup'),
      state: join(home, 'state.json'),
    };
  }

  static resolveHome(): string {
    return normalizePath(join(homedir(), DEFAULT_HOME_DIRECTORY));
  }

  /**
   * How `path` sits against the store, or `null` when the two are unrelated.
   *
   * No registered path may equal, contain, or sit inside the store. The relation
   * is resolved against the filesystem rather than read off the strings, so an
   * ancestor symlink repointed into the store after the fact answers the same as
   * a path written that way.
   *
   * Answers with the collision rather than a boolean, so the refusal can name
   * the relation it refused over.
   */
  findCollisionWith(path: string): Collision | null {
    const relation = relate({ candidate: path, reference: this.paths.root });

    if (!relation) {
      return null;
    }

    return { kind: 'grimoire-home', path: this.paths.root, relation };
  }
}
