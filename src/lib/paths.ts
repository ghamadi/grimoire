import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Registry } from '#src/lib/registry';

// -----------------------------------------------------------------------------
// PATH CANONICALIZATION
// -----------------------------------------------------------------------------

/**
 * Canonicalizes lexically: `~` expands, the rest resolves against the cwd, and
 * `..` and trailing separators collapse. Symlinks are left standing.
 *
 * This is the form that gets stored and printed, which is why it stays lexical:
 * rewriting a symlink the user typed on purpose into its target leaves them
 * reading a path they never wrote. `resolveExisting` is the form to compare.
 */
export function normalizePath(input: string): string {
  return resolve(expandHome(input));
}

/**
 * The form a collision check compares: normalized, then every symlink in the
 * existing prefix followed.
 *
 * Resolves the nearest ancestor that exists and rejoins the rest, because a
 * path under test need not exist yet — `clone` creates its destination. Nothing
 * is lost by stopping there: a segment that does not exist cannot be a symlink.
 */
export function resolveExisting(input: string): string {
  const path = normalizePath(input);

  let current = path;
  let trailing: string[] = [];

  while (true) {
    const resolved = realpathIfExists(current);

    if (resolved) {
      return join(resolved, ...trailing);
    }

    const parent = dirname(current);

    if (parent === current) {
      return path;
    }

    trailing = [basename(current), ...trailing];
    current = parent;
  }
}

// -----------------------------------------------------------------------------
// PATH RELATIONSHIP CHECKING
// -----------------------------------------------------------------------------

/** How a candidate path sits relative to its reference. */
export type Relation = 'equals' | 'contains' | 'inside';

/** The path being placed, and the fixed path it is placed against. */
type RelationComparators = {
  candidate: string;
  reference: string;
};

/**
 * How `candidate` sits relative to `reference`, or `null` when unrelated.
 * Normalizes both sides before checking.
 */
export function relate(comparators: RelationComparators): Relation | null {
  const candidate = normalizePath(comparators.candidate);
  const reference = normalizePath(comparators.reference);

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

// -----------------------------------------------------------------------------
// COLLISION SHAPES
// -----------------------------------------------------------------------------

export type Collision =
  | { kind: 'grimoire-home'; path: string; relation: Relation }
  | {
      kind: 'registered';
      registry: Registry;
      name: string;
      path: string;
      relation: Relation;
    };

export type GrimoireHomeCollision = Extract<Collision, { kind: 'grimoire-home' }>;

export type RegistryCollision = Extract<Collision, { kind: 'registered' }>;

// -----------------------------------------------------------------------------
// GRIMOIRE HOME PATH COLLISION CHECKING
// -----------------------------------------------------------------------------

export type GrimoireHomeCollisionQuery = {
  home: string;
  path: string;
};

/** Checks the provided path against the grimoire home (`~/.grimoire` by default). */
export function findGrimoireHomeCollision(
  query: GrimoireHomeCollisionQuery,
): GrimoireHomeCollision | null {
  const home = normalizePath(query.home);

  const homeRelation = relate({
    candidate: resolveExisting(query.path),
    reference: resolveExisting(home),
  });

  if (homeRelation) {
    return { kind: 'grimoire-home', path: home, relation: homeRelation };
  }

  return null;
}

// -----------------------------------------------------------------------------
// REGISTRY PATH COLLISION CHECKING
// -----------------------------------------------------------------------------

/** Only `path` is read, which is what keeps this module below the store. */
type RegisteredEntries = Record<string, { path: string }>;

export type RegistryCollisionQuery = {
  storeConfig: Record<Registry, RegisteredEntries>;
  path: string;
};

export type WorkspaceCollision = RegistryCollision & { registry: 'workspaces' };

/** Checks the provided path against the registered workspaces. */
export function findWorkspaceCollision(query: RegistryCollisionQuery): WorkspaceCollision | null {
  return findRegistryCollision(query, 'workspaces');
}

export type RepoCollision = RegistryCollision & { registry: 'repos' };

/** Checks the provided path against the registered repos. */
export function findRepoCollision(query: RegistryCollisionQuery): RepoCollision | null {
  return findRegistryCollision(query, 'repos');
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Generic rather than overloaded so the compiler verifies the caller gets the
 * collision it was promised — overload return types are never checked.
 */
function findRegistryCollision<K extends Registry>(
  query: RegistryCollisionQuery,
  registry: K,
): (RegistryCollision & { registry: K }) | null {
  const candidate = resolveExisting(query.path);

  for (const [name, entry] of sortedEntries(query.storeConfig[registry])) {
    // Two forms of the same entry: config.json is hand-editable, so neither is
    // canonical on arrival. The resolved one answers "is this one directory?";
    // the normalized one is what the collision reports, because a message
    // naming a path the user never wrote is a message they cannot act on.
    const path = normalizePath(entry.path);
    const relation = relate({ candidate, reference: resolveExisting(path) });

    if (relation) {
      return { kind: 'registered', registry, name, path, relation };
    }
  }

  return null;
}

/** Sorted by name, so the same config always reports the same collision first. */
function sortedEntries(entries: RegisteredEntries): [string, { path: string }][] {
  return Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));
}

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
