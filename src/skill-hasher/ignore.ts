import { basename, isAbsolute, matchesGlob } from 'node:path';
import { SKILL_MANIFEST } from '#src/lib/directories';

/**
 * One rule is borrowed from gitignore:
 * a pattern with no `/` matches an entry's basename at any depth —
 * the shape bare names need to catch `.DS_Store` wherever Finder
 * drops one — while a pattern containing `/` is anchored to the skill root.
 *
 * Anchoring is the half with no other spelling: were `/` patterns to float too,
 * `build/x.js` could never mean the skill's own `build/` rather than any `build/`
 * nested under it. A leading `**` floats an anchored pattern back.
 *
 * Module-private: not exported from the barrel, so the glob engine stays a
 * one-file swap if `path.matchesGlob` ever has to go.
 */
export function createIgnoreMatcher(patterns: string[]): (skillRelativePath: string) => boolean {
  return (skillRelativePath: string): boolean => {
    if (isAbsolute(skillRelativePath)) {
      throw new Error(
        `ignores() takes a skill-relative path, got an absolute one: "${skillRelativePath}"`,
      );
    }

    // SKILL.md is never ignored.
    if (skillRelativePath === SKILL_MANIFEST) {
      return false;
    }

    return patterns.some((pattern) => {
      const subject = pattern.includes('/') ? skillRelativePath : basename(skillRelativePath);

      return matchesGlob(subject, pattern);
    });
  };
}
