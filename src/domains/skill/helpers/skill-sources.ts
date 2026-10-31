import { readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { assertUsableDirectory } from '@/lib/directories';
import { normalizePath } from '@/lib/paths';
import { Skill } from '@/domains/skill/entity';

// -----------------------------------------------------------------------------
// RESULT SHAPE
// -----------------------------------------------------------------------------

/** A skill directory found at or beneath a crawled path. */
export type SkillSource = {
  name: string;
  path: string;
  location: string;
};

// -----------------------------------------------------------------------------
// THE CRAWL
// -----------------------------------------------------------------------------

/**
 * Every skill directory at or beneath `path`, sorted by name then path.
 *
 * `path` is itself a skill, a container of skills, or a container of
 * containers — the crawl descends until it finds one and stops there, so a
 * nested skill is never reported separately from the one holding it.
 *
 * With `repoUrl`, `path` is a clone of that repo.
 *
 * @throws InvalidPathError if `path` does not exist, is not a directory, or cannot be read.
 */
export function findSkillSources(params: { path: string; repoUrl?: string }): SkillSource[] {
  const { repoUrl } = params;
  const root = normalizePath(params.path);
  assertUsableDirectory(root);

  return collect(root)
    .map((source) => ({
      ...source,
      location: repoUrl === undefined ? source.path : relative(root, source.path) || repoUrl,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function collect(directory: string): Omit<SkillSource, 'location'>[] {
  if (Skill.isSkillDirectory(directory)) {
    return [{ name: basename(directory), path: directory }];
  }

  return (
    readdirSync(directory, { withFileTypes: true })
      // A symlinked subdirectory is skipped, not followed: a workspace is full of
      // symlinks into the store, so following them would rediscover every store
      // skill as a collision against itself, and an indefinite crawl that follows
      // links can loop forever.
      .filter((entry) => entry.isDirectory() && !isIgnoredEntry(entry.name))
      .flatMap((entry) => collect(join(directory, entry.name)))
  );
}

/** Attachment point for `state.json`'s future `ignore` list. */
function isIgnoredEntry(name: string): boolean {
  return name.startsWith('.');
}
