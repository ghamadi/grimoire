import { readdirSync, type Dirent } from 'node:fs';
import { join, sep } from 'node:path';
import { isErrnoException } from '#src/lib/fs';
import { relativeTo } from '#src/lib/paths';

/** A symlink in a workspace pointing at a skill in the store. */
export type StoreLink = {
  /** The workspace entry's own name. */
  skill: string;
  /** The store skill the link resolves into — not always `skill`. */
  storeSkill: string;
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
    .flatMap((entry) => {
      const path = join(query.workspacePath, entry.name);
      const storeSkill = storeSkillOf({ link: path, storeSkills: query.storeSkills });

      return storeSkill === undefined ? [] : [{ skill: entry.name, storeSkill, path }];
    })
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
 * hand-edit of state.json could ever clear, and `status` already reports a
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

/**
 * The store skill the link resolves into, or `undefined` when there is none: the
 * link points outside the store, at the skills root itself, or nowhere.
 */
function storeSkillOf(query: { link: string; storeSkills: string }): string | undefined {
  const relativePath = relativeTo({ candidate: query.link, reference: query.storeSkills });

  return relativePath?.split(sep)[0];
}
