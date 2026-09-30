import { existsSync, readdirSync, readlinkSync, type Dirent } from 'node:fs';
import { join, resolve, sep } from 'node:path';
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

/** A workspace symlink whose target text names a path in the store, where nothing resolves. */
export type DanglingStoreLink = {
  /** The workspace entry's own name. */
  entry: string;
  /** The target text, made absolute against the workspace — not canonicalized. */
  target: string;
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
  return readSymlinks(query.workspacePath).flatMap((symlink) => {
    const storeSkill = storeSkillOf({ link: symlink.path, storeSkills: query.storeSkills });

    return storeSkill === undefined ? [] : [{ skill: symlink.name, storeSkill, path: symlink.path }];
  });
}

/**
 * Every workspace link into the store that resolves nowhere, sorted by entry
 * name: the links `findStoreLinks` leaves out because they resolve nowhere.
 */
export function findDanglingStoreLinks(query: StoreLinkQuery): DanglingStoreLink[] {
  return readSymlinks(query.workspacePath).flatMap((symlink) => {
    const targetPath = resolve(query.workspacePath, readlinkSync(symlink.path));
    const namesStorePath = relativeTo({ candidate: targetPath, reference: query.storeSkills }) !== null;

    return namesStorePath && !existsSync(symlink.path)
      ? [{ entry: symlink.name, target: targetPath }]
      : [];
  });
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

type Symlink = {
  name: string;
  path: string;
};

/** The workspace's symlinks, sorted by name. */
function readSymlinks(workspacePath: string): Symlink[] {
  return readEntries(workspacePath)
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, path: join(workspacePath, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

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
