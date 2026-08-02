import { lstatSync, readdirSync, readlinkSync, type Dirent } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { isErrnoException } from '#src/lib/fs';
import { relate } from '#src/lib/paths';

/** A symlink in a workspace pointing at a skill in the store. */
export type StoreLink = {
  skill: string;
  path: string;
};

export type StoreLinkQuery = {
  workspacePath: string;
  storeSkills: string;
};

/**
 * Every link a workspace holds into the store, sorted by skill name.
 *
 * No discovery walk: workspaces are flat by design, so one `readdir` answers
 * it, and the entry name is the skill name.
 *
 * The link's own path rides along so a caller can `unlink` it without
 * recomputing it.
 */
export function findStoreLinks(query: StoreLinkQuery): StoreLink[] {
  return readEntries(query.workspacePath)
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => ({ skill: entry.name, path: join(query.workspacePath, entry.name) }))
    .filter(({ path }) => isLinkPointingToStore({ link: path, storeSkills: query.storeSkills }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/**
 * A path that is not a directory holds no links — whether it is gone, or has
 * become a file, or sits under one.
 *
 * Reporting any of them as an error would leave a registration that only a
 * hand-edit of config.json could ever clear, and `status` already reports a
 * registered path that no longer resolves.
 *
 * Those two errnos and no others: any remaining failure means the directory
 * might hold links that could not be read, and answering "none" for it is what
 * strands them.
 */
function readEntries(workspacePath: string): Dirent[] {
  try {
    return readdirSync(workspacePath, { withFileTypes: true });
  } catch (error) {
    if (isErrnoException(error, 'ENOENT') || isErrnoException(error, 'ENOTDIR')) {
      return [];
    }
    throw error;
  }
}

/** Checks if a link is pointing to a skill in the store. */
function isLinkPointingToStore(query: { link: string; storeSkills: string }): boolean {
  const relation = relate({
    candidate: followLinkChain(query.link),
    reference: query.storeSkills,
  });

  return relation === 'equals' || relation === 'inside';
}

/** High enough that only a cycle reaches it, which is the one thing it has to stop. */
const maxLinkHops = 32;

/**
 * The path a link finally names, one `readlink` at a time.
 *
 * `realpathSync` walks a whole chain in one call but throws when the end of it
 * is missing, and a dangling link is the case this scan exists to catch —
 * reported as unrelated to the store, `remove` would strand it. Stepping keeps
 * the hops that do resolve, so a chain whose last hop points at a deleted skill
 * still reports the store path it was aimed at.
 *
 * Each hop resolves a relative target against its own directory, not the
 * workspace: only the first link lives there.
 */
function followLinkChain(link: string): string {
  let current = link;

  for (let hop = 0; hop < maxLinkHops && isSymbolicLink(current); hop++) {
    const target = readlinkSync(current);

    current = isAbsolute(target) ? target : join(dirname(current), target);
  }

  return current;
}

function isSymbolicLink(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
}
