import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { assertSkillDirectory } from '#src/lib/directories';
import { UnportableSkillError } from '#src/lib/errors/index';
import { createIgnoreMatcher } from './ignore.ts';

const NUL = Buffer.from([0]);

/**
 * Git's two file modes, and its rule for choosing between them: any execute bit
 * set means executable. The rest of the mode is deliberately not hashed — an
 * owner-read-only file is the same file, and hashing that would make a `umask`
 * difference read as a content change.
 */
const ANY_EXECUTE_BIT = 0o111;
const EXECUTABLE = '100755';
const REGULAR = '100644';

// -----------------------------------------------------------------------------
// RESULT SHAPE
// -----------------------------------------------------------------------------

export type TreeHasher = {
  /**
   * Hex SHA-256 over the skill's files — path, executable bit, and content — with `ignore`
   * applied. Throws InvalidPathError unless the path is a skill directory, and
   * UnportableSkillError on a symlink within.
   */
  hash(skillDirectory: string): string;
  /** The matcher the copy operations use, so a copy and the hash can never disagree about what is skipped. */
  ignores(skillRelativePath: string): boolean;
};

// -----------------------------------------------------------------------------
// CONSTRUCTION
// ---------------------------------------------------------------------------

export function createTreeHasher(options: { ignore: string[] }): TreeHasher {
  const ignores = createIgnoreMatcher(options.ignore);

  return {
    ignores,
    hash(skillDirectory: string): string {
      assertSkillDirectory(skillDirectory);

      const root = realpathSync(skillDirectory);
      const leaves: { rel: string; digest: Buffer }[] = [];

      walk({ root, dir: root, rel: '', ignores, leaves });

      leaves.sort((a, b) => (a.rel < b.rel ? -1 : 1));

      return createHash('sha256')
        .update(Buffer.concat(leaves.map((leaf) => leaf.digest)))
        .digest('hex');
    },
  };
}

// -----------------------------------------------------------------------------
// THE WALK
// -----------------------------------------------------------------------------

function walk(params: {
  root: string;
  dir: string;
  rel: string;
  ignores: (skillRelativePath: string) => boolean;
  leaves: { rel: string; digest: Buffer }[];
}): void {
  const { root, dir, rel: parentRel, ignores, leaves } = params;

  const entries = readdirSync(dir, { withFileTypes: true }).sort((a: Dirent, b: Dirent) =>
    a.name < b.name ? -1 : 1,
  );

  for (const entry of entries) {
    const rel = parentRel === '' ? entry.name : `${parentRel}/${entry.name}`;

    if (ignores(rel)) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      throw new UnportableSkillError({ path: root, entry: rel });
    }

    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      walk({ root, dir: path, rel, ignores, leaves });
      continue;
    }

    if (entry.isFile()) {
      const mode = statSync(path).mode & ANY_EXECUTE_BIT ? EXECUTABLE : REGULAR;
      const content = readFileSync(path);
      const digest = createHash('sha256')
        .update(Buffer.concat([Buffer.from(`${mode} ${rel}`, 'utf8'), NUL, content]))
        .digest(); // raw 32 bytes, not hex — fixed width is what makes the outer concat unforgeable

      leaves.push({ rel, digest });
    }
  }
}
