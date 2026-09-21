import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

// -----------------------------------------------------------------------------
// PATH CANONICALIZATION
// -----------------------------------------------------------------------------

/**
 * Canonicalizes lexically: `~` expands, the rest resolves against the cwd, and
 * `..` and trailing separators collapse. Symlinks are left standing.
 *
 * This is the form that gets stored and printed, which is why it stays lexical:
 * rewriting a symlink the user typed on purpose into its target leaves them
 * reading a path they never wrote.
 */
export function normalizePath(input: string): string {
  return resolve(expandHome(input));
}

// -----------------------------------------------------------------------------
// PATH RELATIONSHIP CHECKING
// -----------------------------------------------------------------------------

/** How a candidate path sits relative to its reference. */
export type PathRelation = 'equals' | 'contains' | 'inside';

/** The path being placed, and the fixed path it is placed against. */
type RelationComparators = {
  candidate: string;
  reference: string;
};

/**
 * How `candidate` sits relative to `reference`, or `null` when unrelated.
 *
 * Both sides are made comparable here rather than by the caller: the rule is
 * about directories, and a caller that hands over two lexical paths gets a
 * confident wrong answer — the dotfiles layout puts a workspace and the repo
 * versioning it one symlink apart with no shared prefix at all.
 */
export function relate(comparators: RelationComparators): PathRelation | null {
  const candidate = toComparablePath(comparators.candidate);
  const reference = toComparablePath(comparators.reference);

  if (candidate === reference) {
    return 'equals';
  }

  if (candidate.startsWith(reference + sep)) {
    return 'inside';
  }

  if (reference.startsWith(candidate + sep)) {
    return 'contains';
  }

  return null;
}

/**
 * Where `candidate` sits under `reference`, or `null` when it does not. Non-null
 * exactly when `relate` answers `inside`.
 */
export function relativeTo(comparators: RelationComparators): string | null {
  const candidate = toComparablePath(comparators.candidate);
  const reference = toComparablePath(comparators.reference);

  return candidate.startsWith(reference + sep) ? candidate.slice(reference.length + sep.length) : null;
}

/**
 * The form two paths get compared in: normalized, then symlinks followed as
 * deep as the filesystem can confirm.
 *
 * Resolution stops at the deepest ancestor that exists and rejoins the segments
 * below it as text. That is exact rather than approximate: a segment that does
 * not exist cannot be a symlink.
 *
 * A plain `realpathSync` with a lexical fallback reads as the same thing and is
 * not — it resolves the two sides to different depths the moment one of them is
 * missing. Store on a volume (`~/.grimoire -> /Volumes/data/grimoire`) plus a
 * workspace link whose skill has since been deleted:
 *
 * without toComparablePath:
 *   candidate → /Users/me/.grimoire/skills/brainstorm  (realpath threw, stayed lexical)
 *   reference → /Volumes/data/grimoire/skills          (realpath succeeded)
 *
 * with toComparablePath:
 *   candidate → /Volumes/data/grimoire/skills/brainstorm
 *   reference → /Volumes/data/grimoire/skills
 *
 * The fact is that `~/.grimoire` points to a different volume, and we're only able
 * to determine that by continually attempting to find the deepest valid ancestor in the path.
 */
function toComparablePath(rawPath: string): string {
  function resolveDeepest(path: string): string {
    // Try to resolve the path. Should resolve immediately if the path is valid.
    const resolved = realpathIfExists(path);

    // Base Case:Once the path is resolved return it.
    if (resolved) {
      return resolved;
    }

    const parent = dirname(path);

    // Base case: if we reached the root of the path we're trying to resolve,
    // return it (regardless whether the root is valid or not)
    if (parent === path) {
      return path;
    }

    // Recursive Case: If the path couldn't be resolved, prepend the current segment
    // with the deepest resolved ancestor starting from the parent.
    return join(resolveDeepest(parent), basename(path));
  }

  // recursively build the canonical path
  return resolveDeepest(normalizePath(rawPath));
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Every failure means the same thing here — missing, unreadable, a symlink
 * cycle — so none of them rethrow: the walk moves up and the answer degrades to
 * the lexical one, which is all this module had before.
 */
function realpathIfExists(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function expandHome(input: string): string {
  if (input === '~') {
    return homedir();
  }

  return input.startsWith(`~${sep}`) ? resolve(homedir(), input.slice(2)) : input;
}
