import { lstatSync, readdirSync, readFileSync, type Dirent, type Stats } from 'node:fs';
import { join } from 'node:path';
import { assertUsableDirectory } from '@/lib/directories';
import { isJunkFile } from '@/lib/junk-files';

// -----------------------------------------------------------------------------
// RESULT SHAPE
// -----------------------------------------------------------------------------

/** The directory being placed, and the fixed directory it is placed against. */
export type ContainmentComparators = {
  candidate: string;
  reference: string;
};

/**
 * That the candidate is contained, or the entry that proves it is not.
 *
 * `entry` is candidate-relative and names the first offender the walk reaches —
 * the one thing to go look at, rather than a verdict on the whole directory.
 * An `unportable` result carries the root holding the symlink, because either
 * side can hold one and they are not the same thing to fix.
 */
export type DirectoryContainment =
  | { kind: 'contained' }
  | { kind: 'differs'; entry: string }
  | { kind: 'unportable'; root: string; entry: string };

// -----------------------------------------------------------------------------
// THE COMPARISON
// -----------------------------------------------------------------------------

/**
 * Git's rule for the one mode bit a copy has to carry: any execute bit set
 * means executable. The rest of the mode is deliberately out — a `umask`
 * difference is not a content change.
 */
const ANY_EXECUTE_BIT = 0o111;

/**
 * Whether every entry under `candidate` already exists, identically, under
 * `reference`.
 *
 * This is the question asked before a directory is destroyed, so it is
 * containment rather than equality: what the reference holds and the candidate
 * does not costs nothing to lose, while everything the candidate holds has to
 * be proven to survive. The one thing skipped is a file `isJunkFile` proves the
 * operating system wrote. The user's `ignore` list stays out: a glob there could
 * name real files, and this is the check that precedes a deletion.
 *
 * Entries are read depth first in lexicographic order, so the entry a refusal
 * names is the same one on every filesystem.
 *
 * @throws InvalidPathError unless both paths are existing directories.
 */
export function compareContainment(comparators: ContainmentComparators): DirectoryContainment {
  assertUsableDirectory(comparators.candidate);
  assertUsableDirectory(comparators.reference);

  return walk({
    roots: comparators,
    candidateDirectory: comparators.candidate,
    referenceDirectory: comparators.reference,
    parentRel: '',
  });
}

// -----------------------------------------------------------------------------
// THE WALK
// -----------------------------------------------------------------------------

function walk(params: {
  roots: ContainmentComparators;
  candidateDirectory: string;
  referenceDirectory: string;
  parentRel: string;
}): DirectoryContainment {
  const { roots, candidateDirectory, referenceDirectory, parentRel } = params;

  const entries = readdirSync(candidateDirectory, { withFileTypes: true }).sort(byName);

  for (const candidateEntry of entries) {
    const rel = parentRel === '' ? candidateEntry.name : `${parentRel}/${candidateEntry.name}`;
    const candidateEntryPath = join(candidateDirectory, candidateEntry.name);
    const referenceEntryPath = join(referenceDirectory, candidateEntry.name);

    if (isJunkFile({ path: candidateEntryPath })) {
      continue;
    }

    // Refuse the comparison if the candidate directory has a symbolic link
    if (candidateEntry.isSymbolicLink()) {
      return { kind: 'unportable', root: roots.candidate, entry: rel };
    }

    const referenceEntryStatus = lstatSync(referenceEntryPath, { throwIfNoEntry: false });

    // If no matching entry exists in the reference, the candidate directory differs.
    if (!referenceEntryStatus) {
      return { kind: 'differs', entry: rel };
    }

    // Refuse the comparison if the reference directory has a symbolic link
    if (referenceEntryStatus.isSymbolicLink()) {
      return { kind: 'unportable', root: roots.reference, entry: rel };
    }

    if (candidateEntry.isDirectory()) {
      if (!referenceEntryStatus.isDirectory()) {
        return { kind: 'differs', entry: rel };
      }

      // Walk candidate subdirectories to ensure they are contained in the matching reference subdirectories
      const subDirectoryContainment = walk({
        roots,
        candidateDirectory: candidateEntryPath,
        referenceDirectory: referenceEntryPath,
        parentRel: rel,
      });

      if (subDirectoryContainment.kind !== 'contained') {
        return subDirectoryContainment;
      }

      continue;
    }

    // A socket, a device, a FIFO: not a thing this can prove survives.
    if (!candidateEntry.isFile() || !referenceEntryStatus.isFile()) {
      return { kind: 'differs', entry: rel };
    }

    if (
      !isSameFile({
        candidatePath: candidateEntryPath,
        referencePath: referenceEntryPath,
        referenceStatus: referenceEntryStatus,
        candidateStatus: lstatSync(candidateEntryPath),
      })
    ) {
      return { kind: 'differs', entry: rel };
    }
  }

  return { kind: 'contained' };
}

function byName(a: Dirent, b: Dirent): number {
  return a.name < b.name ? -1 : 1;
}

/**
 * @returns true if and only if the candidate and reference files match byte for byte, and false otherwise.
 */
function isSameFile(params: {
  referencePath: string;
  referenceStatus: Stats;
  candidatePath: string;
  candidateStatus: Stats;
}): boolean {
  const { candidatePath, candidateStatus, referencePath, referenceStatus } = params;

  if (isExecutable(candidateStatus) !== isExecutable(referenceStatus)) {
    return false;
  }

  if (candidateStatus.size !== referenceStatus.size) {
    return false;
  }

  return readFileSync(candidatePath).equals(readFileSync(referencePath));
}

function isExecutable(status: Stats): boolean {
  return (status.mode & ANY_EXECUTE_BIT) !== 0;
}
