import { readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { assertUsableDirectory, isSkillDirectory } from '#src/lib/directories';
import { isErrnoException } from '#src/lib/fs';

// -----------------------------------------------------------------------------
// RESULT SHAPES
// -----------------------------------------------------------------------------

/** A skill found by the walk, at the path it was found. */
export type ScannedSkill = {
  name: string;
  path: string;
};

// -----------------------------------------------------------------------------
// SCANNING
// -----------------------------------------------------------------------------

/**
 * Every skill a directory holds, sorted by name in code point order — the same
 * order on every machine, unlike a locale-aware collation.
 *
 * A skill directory is a directory that contains a `SKILL.md` file, and the scan
 * does not look for nested skill directories.
 *
 * Every path is resolved before it is read, so a skill is found at the directory
 * that holds it and is named by that directory — a symlink is a way to reach a
 * skill, never a second skill. A root that itself holds `SKILL.md` is that
 * skill.
 *
 * A name held twice resolves to the first copy the walk reaches, however deep;
 * the rest are ignored.
 */
export function scanSkills(root: string): ScannedSkill[] {
  assertUsableDirectory(root);

  const directory = realpathSync(root);

  if (isSkillDirectory(directory)) {
    return [{ name: basename(directory), path: directory }];
  }

  const found = new Map<string, string>();

  walkDirectory({ found, visited: new Set([directory]), directory });

  return [...found].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, path]) => ({ name, path }));
}

// -----------------------------------------------------------------------------
// THE WALK
// -----------------------------------------------------------------------------

/**
 * Explores one resolved directory depth-first, recording the first path each
 * name resolves to.
 *
 * Entries are read in lexicographic order rather than the order the filesystem
 * returns them. That order is arbitrary but it must not be the filesystem's:
 * `readdir` answers in hash order on some of them, and which copy of a
 * duplicated name a repo resolves to would then vary by machine.
 *
 * `visited` holds the directories already descended into, which is what ends a
 * symlink cycle. A skill is never descended into, so it needs no entry.
 */
function walkDirectory(params: {
  found: Map<string, string>;
  visited: Set<string>;
  directory: string;
}): void {
  const { found, visited, directory: parent } = params;

  for (const entry of readdirSync(parent).sort()) {
    const directory = resolveDirectory(join(parent, entry));

    if (!directory) {
      continue;
    }

    const name = basename(directory);

    // skip hidden directories
    if (name.startsWith('.')) {
      continue;
    }

    if (isSkillDirectory(directory)) {
      found.set(name, found.get(name) ?? directory); // first found wins
      continue;
    }

    if (visited.has(directory)) {
      continue;
    }

    visited.add(directory);
    walkDirectory({ found, visited, directory });
  }
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/** Nothing at the end of the link, a file part-way along it, or a cycle. */
const LEADS_NOWHERE = ['ENOENT', 'ENOTDIR', 'ELOOP'] as const;

/**
 * The directory an entry stands for, symlinks resolved, or null when the entry
 * is not a usable directory.
 *
 * A link that leads nowhere is passed over. Anything else means a directory
 * that might hold skills could not be read, and answering "none" for it is what
 * strands them.
 */
function resolveDirectory(path: string): string | null {
  try {
    const resolved = realpathSync(path);

    return statSync(resolved).isDirectory() ? resolved : null;
  } catch (error) {
    if (LEADS_NOWHERE.some((code) => isErrnoException(error, code))) {
      return null;
    }
    throw error;
  }
}
