import { statSync } from 'node:fs';
import { join } from 'node:path';
import { InvalidPathError } from '#src/lib/errors/index';

/**
 * A path that does not exist has exactly one meaning — a typo.
 */
export function assertUsableDirectory(path: string): void {
  const status = statSync(path, { throwIfNoEntry: false });

  if (!status) {
    throw new InvalidPathError({ path, reason: 'missing' });
  }

  if (!status.isDirectory()) {
    throw new InvalidPathError({ path, reason: 'not-a-directory' });
  }
}

/** The file whose presence makes a directory a skill. */
export const SKILL_MANIFEST = 'SKILL.md';

/** A directory containing `SKILL.md` is a skill. */
export function isSkillDirectory(path: string): boolean {
  return statSync(join(path, SKILL_MANIFEST), { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * For operations whose subject is one skill rather than any directory. A bucket
 * or the store root would otherwise be walked as if it were a skill and answered
 * plausibly instead of refused.
 */
export function assertSkillDirectory(path: string): void {
  assertUsableDirectory(path);

  if (!isSkillDirectory(path)) {
    throw new InvalidPathError({ path, reason: 'not-a-skill' });
  }
}
