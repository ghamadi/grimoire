import { lstatSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { safeFlattenDirectory } from '@/lib/directories';
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

  constructor(params: SkillParams) {
    this.name = params.name;
    this.path = params.path;
    this.flattenedTree = safeFlattenDirectory(this.path).sort();
  }

  /**
   * Creates a skill with a verified path.
   * @throws InvalidPathError if the path does not exist, is not a directory, or holds no SKILL.md.
   */
  static createVerified(params: SkillParams): Skill {
    const skill = new Skill(params);
    return skill.verify();
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

  /**
   * Confirms that this skill's path exists, is a directory, and holds SKILL.md.
   */
  verify(): Skill {
    const path = this.path;

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

    // verify that the skill does not contain multiple SKILL.md files (no nested skills)
    const skillManifests = this.flattenedTree.filter((path) => basename(path) === SKILL_MANIFEST);
    if (skillManifests.length > 1) {
      throw new UnportableSkillError({ path, reason: 'nested-skill' });
    }

    // verify that the skill does not contain unsupported files
    const containsUnsupportedFiles = this.flattenedTree.some((path) => {
      const status = lstatSync(path, { throwIfNoEntry: false });
      return (
        !status ||
        status.isBlockDevice() ||
        status.isCharacterDevice() ||
        status.isFIFO() ||
        status.isSocket()
      );
    });

    if (containsUnsupportedFiles) {
      throw new UnportableSkillError({ path, reason: 'unexpected-file-type' });
    }

    return this;
  }
}
