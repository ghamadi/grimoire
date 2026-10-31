import { lstatSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { flattenDirectory } from '@/lib/directories';
import { InvalidPathError, UnportableSkillError } from '@/lib/errors';
import { isErrnoException, tryStatSync } from '@/lib/fs';

export const SKILL_MANIFEST = 'SKILL.md';

export type SkillParams = {
  name: string;
  path: string;
};

export class Skill {
  readonly name: string;
  readonly path: string;
  readonly flattenedTree: string[];

  private constructor(params: SkillParams & { flattenedTree: string[] }) {
    this.name = params.name;
    this.path = params.path;
    this.flattenedTree = params.flattenedTree;
  }

  /**
   * Creates a skill with a verified path.
   * @throws InvalidPathError if the path does not exist, is not a directory, or holds no SKILL.md.
   */
  static createVerified(params: SkillParams): Skill {
    const { name, path } = params;

    const status = tryStatSync(path);

    if (!status) {
      throw new InvalidPathError({ path, reason: 'missing' });
    }

    if (!status.isDirectory()) {
      throw new InvalidPathError({ path, reason: 'not-a-directory' });
    }

    if (!Skill.isSkillDirectory(path)) {
      throw new UnportableSkillError({ path, reason: 'not-a-skill' });
    }

    const flattenedTree = flattenDirectory(path).sort();

    // verify that the skill does not contain multiple SKILL.md files (no nested skills)
    const skillManifests = flattenedTree.filter((entry) => basename(entry) === SKILL_MANIFEST);
    if (skillManifests.length > 1) {
      throw new UnportableSkillError({ path, reason: 'nested-skill' });
    }

    // verify that the skill does not contain unsupported files
    for (const entry of flattenedTree) {
      const status = lstatSync(entry, { throwIfNoEntry: false });
      const isUnsupported =
        !status ||
        status.isBlockDevice() ||
        status.isCharacterDevice() ||
        status.isFIFO() ||
        status.isSocket();

      if (isUnsupported) {
        throw new UnportableSkillError({ path, reason: 'unexpected-file-type' });
      }
    }

    return new Skill({ name, path, flattenedTree });
  }

  /** A path that loops or cannot be entered holds no SKILL.md that can be shown, so it is not a skill directory. */
  static isSkillDirectory(path: string): boolean {
    try {
      return statSync(join(path, SKILL_MANIFEST), { throwIfNoEntry: false })?.isFile() ?? false;
    } catch (error) {
      if (
        isErrnoException(error, 'ELOOP') ||
        isErrnoException(error, 'EACCES') ||
        isErrnoException(error, 'EPERM')
      ) {
        return false;
      }

      throw error;
    }
  }
}
