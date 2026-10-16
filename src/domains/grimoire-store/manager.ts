import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { extractJsonContent, writeAtomic } from '@/lib/utils/files';
import type { Collision, GrimoireStore } from '@/domains/grimoire-store/entity';
import { StoreState, type CloneRecord } from '@/domains/grimoire-store/value-objects/store-state';
import { DuplicateNameError } from '@/lib/errors/duplicate-name';
import { toRegisteredPath } from '@/domains/grimoire-store/helpers/registered-path';
import {
  CollidingRegistrationError,
  EntityNotFoundError,
  InvalidNameError,
  InvalidPathError,
  PathCollisionError,
  type RegistryEntity,
} from '@/lib/errors/index';
import { join, matchesGlob } from 'node:path';
import { InvalidShapeError } from '@/lib/errors/invalid-shape';
import {
  findDanglingStoreLinks,
  findStoreLinks,
  type DanglingStoreLink,
  type StoreLink,
} from '@/domains/grimoire-store/helpers/store-links';
import { Skill } from '@/domains/skill/entity';
import { copyTree, movePath } from '@/lib/fs';
import { Repo } from '@/domains/repo/index';
import { Workspace } from '@/domains/workspace/index';
import { isInsideGitWorkTree } from '@/lib/git';
import { trashBinName } from '@/domains/grimoire-store/helpers/trash';
import { normalizePath, relate } from '@/lib/paths';

type RegisterWorkspaceParams = {
  name: string;
  path: string;
  autoLink?: boolean;
};

/** A directory a skill was cloned into, as its clone record resolves. */
export type SkillClone = {
  /** What the record names — a workspace's name or a path. */
  origin: string;
  /** The cloned skill's directory. */
  path: string;
  record: CloneRecord;
};

/** A clone record as `state.json` files it, and the directory it names. */
export type FiledClone = {
  skill: string;
  record: CloneRecord;
  /** `<workspace path or recorded path>/<skill>`, normalized. */
  path: string;
};

/** A workspace as `state.json` holds it, carrying the name it is filed under. */
export type RegisteredWorkspace = {
  name: string;
  path: string;
  autoLink: boolean;
};

/** A repo as `state.json` holds it, carrying the name it is filed under. */
export type RegisteredRepo = {
  name: string;
  path: string;
};

export class GrimoireStoreManager {
  private readonly store: GrimoireStore;
  private readonly storeSubdirectories: readonly string[];

  constructor(store: GrimoireStore) {
    this.store = store;
    this.storeSubdirectories = [
      this.store.paths.skills,
      this.store.paths.trash,
      this.store.paths.backup,
    ];
  }

  registerWorkspace(params: RegisterWorkspaceParams) {
    const { name, autoLink = false } = params;

    assertNameIsValid({ entity: 'workspace', name });

    const storeState = this.loadState();

    assertNameIsAvailable({ entity: 'workspace', registry: storeState.workspacesRegistry, name });

    const collision =
      this.store.findCollisionWith(params.path) ??
      findRegistryCollision({
        path: params.path,
        kind: 'repo',
        registry: storeState.reposRegistry,
      });

    if (collision) {
      throw new PathCollisionError({ path: params.path, collision });
    }

    // Handled last because it can create a directory: a refused registration
    // has to leave nothing behind, so every other refusal comes first.
    const { path, created } = toRegisteredPath({ path: params.path, createIfMissing: true });

    this.saveState(storeState.withWorkspace({ name, path, autoLink }));

    return { path, created };
  }

  getRegistry() {
    const storeState = this.loadState();
    return storeState.toJSON();
  }

  requireRegisteredWorkspace(name: string): RegisteredWorkspace {
    return requireRegistered({
      entity: 'workspace',
      registry: this.loadState().workspacesRegistry,
      name,
    });
  }

  /**
   * Drops a workspace from the registry and returns what it dropped.
   *
   * The registration only: the directory and whatever it holds outlive this call.
   *
   * @throws EntityNotFoundError if no workspace is registered under that name.
   * @throws Error if a `{ workspace }` clone record still names it; settle those first.
   */
  unregisterWorkspace(name: string): RegisteredWorkspace {
    const storeState = this.loadState();
    const workspace = requireRegistered({
      entity: 'workspace',
      registry: storeState.workspacesRegistry,
      name,
    });
    const clonedSkills = storeState.skillsClonedIntoWorkspace(name);

    if (clonedSkills.length > 0) {
      throw new Error(
        `cannot unregister workspace "${name}": clone records still name it (${clonedSkills.join(', ')})`,
      );
    }

    this.saveState(storeState.withoutWorkspace(name));

    return workspace;
  }

  /**
   * Files a workspace under a new name, keeping its path and auto-link setting,
   * and returns it as renamed. Clone records naming the workspace follow it.
   * Renaming to the same name writes nothing and answers `renamed: false`.
   *
   * @throws EntityNotFoundError if no workspace is registered under `name`.
   * @throws InvalidNameError if `newName` fails `Workspace.isValidName`.
   * @throws DuplicateNameError if another workspace is registered under `newName`.
   */
  renameWorkspace(params: { name: string; newName: string }): {
    workspace: RegisteredWorkspace;
    renamed: boolean;
  } {
    const storeState = this.loadState();
    const { registration, isSameName } = checkRename({
      entity: 'workspace',
      registry: storeState.workspacesRegistry,
      name: params.name,
      newName: params.newName,
    });

    if (isSameName) {
      return { workspace: registration, renamed: false };
    }

    const workspace = { ...registration, name: params.newName };

    this.saveState(
      storeState
        .withoutWorkspace(params.name)
        .withWorkspace(workspace)
        .withClonesRecordedByName({ workspace: params.name, newName: params.newName }),
    );

    return { workspace, renamed: true };
  }

  /**
   * Every registered workspace, sorted by name.
   */
  listRegisteredWorkspaces(): RegisteredWorkspace[] {
    const storeState = this.loadState();

    return Object.entries(storeState.workspacesRegistry)
      .map(([name, workspace]) => ({ name, ...workspace }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Rewrites the workspace's clone records to carry `path`,
   * and returns the skills it rewrote.
   */
  recordClonesByPath(params: { workspace: string; path: string }): string[] {
    const state = this.loadState();
    const skills = state.skillsClonedIntoWorkspace(params.workspace);

    if (skills.length > 0) {
      this.saveState(state.withClonesRecordedByPath(params));
    }

    return skills;
  }

  /**
   * Drops the workspace's clone records, and returns the skills it dropped
   * them for.
   *
   * The cloned directories themselves are left alone: forgetting a record
   * surrenders grimoire's claim on a copy, it does not touch the copy.
   */
  forgetSkillsClonedIntoWorkspace(workspaceName: string): string[] {
    const state = this.loadState();
    const skills = state.skillsClonedIntoWorkspace(workspaceName);

    if (skills.length > 0) {
      this.saveState(state.withoutClonesIntoWorkspace(workspaceName));
    }

    return skills;
  }

  /**
   * Every link the workspace holds into this store's skills, sorted by skill
   * name.
   *
   * Both halves of the question stay in here: the name resolves through the
   * registry this manager owns, and the scan runs against this manager's own
   * skills root.
   *
   * @throws EntityNotFoundError if no workspace is registered under that name.
   */
  findLinksFromWorkspace(workspaceName: string): StoreLink[] {
    const workspace = this.requireRegisteredWorkspace(workspaceName);

    return findStoreLinks({
      workspacePath: workspace.path,
      storeSkills: this.store.paths.skills,
    });
  }

  /**
   * Every link the workspace holds into this store's skills that resolves
   * nowhere, sorted by entry name.
   *
   * @throws EntityNotFoundError if no workspace is registered under that name.
   */
  findDanglingLinksFromWorkspace(workspaceName: string): DanglingStoreLink[] {
    const workspace = this.requireRegisteredWorkspace(workspaceName);

    return findDanglingStoreLinks({
      workspacePath: workspace.path,
      storeSkills: this.store.paths.skills,
    });
  }

  /** The store's `skills/` directory, whether or not it exists. */
  skillsDirectory(): string {
    return this.store.paths.skills;
  }

  /** The store's `state.json`, whether or not it exists. */
  statePath(): string {
    return this.store.paths.state;
  }

  /** The store's path for a skill, whether or not it exists. */
  skillPath(name: string): string {
    return join(this.store.paths.skills, name);
  }

  /**
   * The store's path for a skill.
   * @throws EntityNotFoundError if the store does not hold it.
   */
  requireSkillPath(name: string) {
    this.ensureLayout();
    const path = this.skillPath(name);
    if (!existsSync(path)) {
      throw new EntityNotFoundError({ entity: 'skill', name });
    }
    return path;
  }

  /** @throws PathCollisionError if the path equals, contains, or sits inside the store. */
  assertOutsideStore(path: string): void {
    const collision = this.store.findCollisionWith(path);

    if (collision) {
      throw new PathCollisionError({ path, collision });
    }
  }

  /** Copies a skill directory into the store verbatim, and returns where it landed. */
  addSkill(params: { name: string; sourcePath: string }): string {
    this.ensureLayout();
    this.assertOutsideStore(params.sourcePath);

    const destination = this.skillPath(params.name);

    copyTree({ from: params.sourcePath, to: destination });

    return destination;
  }

  /**
   * The names of every skill the store holds, sorted.
   *
   * Filtered rather than trusted: a hand-dropped file or a directory without a
   * manifest sits in `skills/` looking like a skill, and would reach a bulk run
   * as one.
   */
  listSkillNames(): string[] {
    this.ensureLayout();

    return readdirSync(this.store.paths.skills)
      .filter((name) => Skill.isSkillDirectory(join(this.store.paths.skills, name)))
      .sort((a, b) => a.localeCompare(b));
  }

  /** Every entry in the store's `skills/` that is not a skill and matches no `ignore` glob, sorted. */
  listStrayEntryNames(): string[] {
    const state = this.loadState();

    return readdirSync(this.store.paths.skills)
      .filter((name) => !Skill.isSkillDirectory(join(this.store.paths.skills, name)))
      .filter((name) => !state.ignoredGlobs.some((glob) => matchesGlob(name, glob)))
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Every directory the skill is recorded as cloned into, in record order.
   *
   * The recorded path is joined as-is, not normalized, so `origin` prints the
   * path the action takes.
   */
  listSkillClones(name: string): SkillClone[] {
    const state = this.loadState();

    return state.clonesOfSkill(name).map((record): SkillClone => {
      if ('path' in record) {
        return { origin: record.path, path: join(record.path, name), record };
      }

      const workspace = requireWorkspaceInState(state, record.workspace);

      return { origin: record.workspace, path: join(workspace.path, name), record };
    });
  }

  /**
   * Every clone record in `state.json`, by skill name, then record order.
   */
  listFiledClones(): FiledClone[] {
    const state = this.loadState();

    return Object.entries(state.skillsByName)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([skill, { clones }]) =>
        clones.map((record): FiledClone => {
          if ('path' in record) {
            return { skill, record, path: join(normalizePath(record.path), skill) };
          }

          const workspace = requireWorkspaceInState(state, record.workspace);

          return { skill, record, path: join(workspace.path, skill) };
        }),
      );
  }

  /**
   * The skill's recorded clone whose directory is `<directory>/<skill>`, by either record arm,
   * compared canonically; the first in record order, or `undefined`.
   */
  findSkillClone(params: { skill: string; directory: string }): SkillClone | undefined {
    const target = join(params.directory, params.skill);

    return this.listSkillClones(params.skill).find(
      (clone) => relate({ candidate: clone.path, reference: target }) === 'equals',
    );
  }

  /**
   * Adds `{ workspace }` to the skill's records, creating its entry; writes nothing when the
   * workspace's directory is already recorded, by either arm — see `findSkillClone`.
   *
   * @throws EntityNotFoundError if `workspace` is not registered.
   */
  recordClone(params: { skill: string; workspace: string }): void {
    const workspace = this.requireRegisteredWorkspace(params.workspace);

    if (this.findSkillClone({ skill: params.skill, directory: workspace.path })) {
      return;
    }

    const state = this.loadState();

    this.saveState(
      state.withCloneOfSkill({ skill: params.skill, record: { workspace: params.workspace } }),
    );
  }

  /** Drops exactly this record. The skill's entry stays, with `clones: []` if it was the last. */
  forgetClone(params: { skill: string; record: CloneRecord }): void {
    const state = this.loadState();

    if (!state.holdsCloneRecord(params)) {
      return;
    }

    this.saveState(state.withoutCloneOfSkill(params));
  }

  /**
   * Moves the store copy into a fresh bin under `.trash/`, and returns the
   * bin's path.
   *
   * @throws EntityNotFoundError if the store does not hold the skill.
   */
  trashSkill(params: { name: string; at: Date }): string {
    const storePath = this.requireSkillPath(params.name);
    const binPath = this.freeBinPath(trashBinName({ skill: params.name, at: params.at }));

    mkdirSync(binPath, { recursive: true });
    movePath({ from: storePath, to: join(binPath, 'store') });

    return binPath;
  }

  /** Deletes every entry under `.trash/` and returns their paths sorted by name, leaving `.trash/` itself. */
  emptyTrash(): string[] {
    this.ensureLayout();

    const entryPaths = readdirSync(this.store.paths.trash)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => join(this.store.paths.trash, name));

    for (const entryPath of entryPaths) {
      rmSync(entryPath, { recursive: true, force: true });
    }

    return entryPaths;
  }

  /** Drops the skill's whole entry from `state.json`, writing nothing when it has none. */
  forgetSkill(name: string): void {
    const state = this.loadState();

    if (!Object.hasOwn(state.skillsByName, name)) {
      return;
    }

    this.saveState(state.withoutSkill(name));
  }

  // --------------------------------------------------------------------------
  // REPOS
  // --------------------------------------------------------------------------

  /**
   * Registers an existing directory inside a git work tree, normalized.
   *
   * @throws InvalidNameError if the name fails `Repo.isValidName`.
   * @throws DuplicateNameError if a repo is already registered under the name.
   * @throws PathCollisionError if the path equals, contains, or sits inside the store
   * or a registered workspace's path.
   * @throws InvalidPathError if the path is not an existing, non-symlink directory
   * inside a git work tree.
   * @throws GitUnavailableError if git cannot be spawned.
   */
  registerRepo(params: { name: string; path: string }): RegisteredRepo {
    const { name } = params;

    assertNameIsValid({ entity: 'repo', name });

    const storeState = this.loadState();

    assertNameIsAvailable({ entity: 'repo', registry: storeState.reposRegistry, name });

    const collision =
      this.store.findCollisionWith(params.path) ??
      findRegistryCollision({
        path: params.path,
        kind: 'workspace',
        registry: storeState.workspacesRegistry,
      });

    if (collision) {
      throw new PathCollisionError({ path: params.path, collision });
    }

    const { path } = toRegisteredPath({ path: params.path });

    if (!isInsideGitWorkTree({ directory: path })) {
      throw new InvalidPathError({ path, reason: 'not-in-git-work-tree' });
    }

    this.saveState(storeState.withRepo({ name, path }));

    return { name, path };
  }

  /**
   * @throws EntityNotFoundError if no repo is registered under that name.
   */
  requireRegisteredRepo(name: string): RegisteredRepo {
    return requireRegistered({ entity: 'repo', registry: this.loadState().reposRegistry, name });
  }

  /**
   * Drops a repo from the registry and returns what it dropped. The registration
   * only: the directory is left alone.
   *
   * @throws EntityNotFoundError if no repo is registered under that name.
   */
  unregisterRepo(name: string): RegisteredRepo {
    const storeState = this.loadState();
    const repo = requireRegistered({ entity: 'repo', registry: storeState.reposRegistry, name });

    this.saveState(storeState.withoutRepo(name));

    return repo;
  }

  /**
   * Files a repo under a new name, keeping its path, and returns it as renamed.
   * Renaming to the same name writes nothing and answers `renamed: false`.
   *
   * @throws EntityNotFoundError if no repo is registered under `name`.
   * @throws InvalidNameError if `newName` fails `Repo.isValidName`.
   * @throws DuplicateNameError if another repo is registered under `newName`.
   */
  renameRepo(params: { name: string; newName: string }): { repo: RegisteredRepo; renamed: boolean } {
    const storeState = this.loadState();
    const { registration, isSameName } = checkRename({
      entity: 'repo',
      registry: storeState.reposRegistry,
      name: params.name,
      newName: params.newName,
    });

    if (isSameName) {
      return { repo: registration, renamed: false };
    }

    const repo = { ...registration, name: params.newName };

    this.saveState(storeState.withoutRepo(params.name).withRepo(repo));

    return { repo, renamed: true };
  }

  /**
   * Every registered repo, sorted by name.
   */
  listRegisteredRepos(): RegisteredRepo[] {
    const storeState = this.loadState();

    return Object.entries(storeState.reposRegistry)
      .map(([name, repo]) => ({ name, ...repo }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // --------------------------------------------------------------------------
  // PRIVATE METHODS
  // --------------------------------------------------------------------------

  /**
   * The document on disk, with every registration it holds vetted.
   *
   * The collision rule is asserted here rather than by each caller;
   * a StoreManager does not load an invalid state, ever.
   */
  private loadState(): StoreState {
    const state = this.readState();
    assertNoCollidingRegistrations({ state, store: this.store });
    return state;
  }

  /** The document as it sits on disk, shape vetted and nothing else. */
  private readState(): StoreState {
    this.ensureLayout();

    const stateData = readJsonFile(this.store.paths.state);

    return stateData === undefined ? StoreState.default() : StoreState.parse(stateData);
  }

  private saveState(state: StoreState): void {
    this.ensureLayout();
    writeAtomic(this.store.paths.state, JSON.stringify(state.toJSON(), null, 2));
  }

  /** `<trash>/<binName>`, suffixed `-2`, `-3`, … until it names nothing. */
  private freeBinPath(binName: string): string {
    let candidate = join(this.store.paths.trash, binName);

    for (let suffix = 2; existsSync(candidate); suffix++) {
      candidate = join(this.store.paths.trash, `${binName}-${suffix}`);
    }

    return candidate;
  }

  /**
   * Creates the store's directory scaffold, including `root` itself.
   * Idempotent - does nothing if the layout already exists.
   *
   * Must be called before any operation touching the store, so that reading
   * and writing always finds a path that loads.
   */
  private ensureLayout(): void {
    for (const dir of this.storeSubdirectories) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ----------------------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------------------

/**
 * Refuses the whole registry over the first registration whose path touches the
 * store, then over the first workspace whose path overlaps a repo's, by workspace
 * name then repo name.
 *
 * Sorted, so a registry holding two of them names the same one every run rather
 * than whichever the object happened to yield first. Against the store,
 * workspaces are checked before repos.
 */
function assertNoCollidingRegistrations(query: { state: StoreState; store: GrimoireStore }): void {
  const storeState = query.store.paths.state;
  const workspaces = Object.entries(query.state.workspacesRegistry)
    .sort(byName)
    .map(([name, { path }]) => ({ entity: 'workspace' as const, name, path }));
  const repos = Object.entries(query.state.reposRegistry)
    .sort(byName)
    .map(([name, { path }]) => ({ entity: 'repo' as const, name, path }));

  for (const registration of [...workspaces, ...repos]) {
    const collision = query.store.findCollisionWith(registration.path);

    if (collision) {
      throw new CollidingRegistrationError({ ...registration, collision, storeState });
    }
  }

  for (const registration of workspaces) {
    const collision = findRegistryCollision({
      path: registration.path,
      kind: 'repo',
      registry: query.state.reposRegistry,
    });

    if (collision) {
      throw new CollidingRegistrationError({ ...registration, collision, storeState });
    }
  }
}

function byName([a]: [string, unknown], [b]: [string, unknown]): number {
  return a.localeCompare(b);
}

/** The first entry by name whose path `path` equals, contains, or sits inside, or `null`. */
function findRegistryCollision(query: {
  path: string;
  kind: 'workspace' | 'repo';
  registry: Readonly<Record<string, { readonly path: string }>>;
}): Collision | null {
  const entries = Object.entries(query.registry).sort(byName);

  for (const [name, entry] of entries) {
    const relation = relate({ candidate: query.path, reference: entry.path });

    if (relation) {
      return { kind: query.kind, name, path: entry.path, relation };
    }
  }

  return null;
}

/**
 * The entry filed under `name`, or `undefined`.
 *
 * `hasOwn` rather than a truthiness check: `workspaces['toString']` answers
 * with the method every object inherits.
 */
function findRegistered<T extends object>(
  registry: Readonly<Record<string, T>>,
  name: string,
): ({ name: string } & T) | undefined {
  return Object.hasOwn(registry, name) ? { name, ...registry[name]! } : undefined;
}

const isValidNameByEntity: Record<RegistryEntity, (name: string) => boolean> = {
  workspace: (name) => Workspace.isValidName(name),
  repo: (name) => Repo.isValidName(name),
};

function assertNameIsValid(params: { entity: RegistryEntity; name: string }): void {
  const { entity, name } = params;

  if (!isValidNameByEntity[entity](name)) {
    throw new InvalidNameError({ entity, name });
  }
}

function assertNameIsAvailable<T>(params: {
  entity: RegistryEntity;
  registry: Readonly<Record<string, T>>;
  name: string;
}): void {
  const { entity, registry, name } = params;

  if (Object.hasOwn(registry, name)) {
    throw new DuplicateNameError({ entity, name });
  }
}

function requireRegistered<T extends object>(params: {
  entity: RegistryEntity;
  registry: Readonly<Record<string, T>>;
  name: string;
}): { name: string } & T {
  const { entity, registry, name } = params;
  const registration = findRegistered(registry, name);

  if (!registration) {
    throw new EntityNotFoundError({ entity, name });
  }

  return registration;
}

function requireWorkspaceInState(state: StoreState, name: string): RegisteredWorkspace {
  return requireRegistered({ entity: 'workspace', registry: state.workspacesRegistry, name });
}

/** The entry a rename starts from, and whether `newName` is its current name. */
function checkRename<T extends object>(params: {
  entity: RegistryEntity;
  registry: Readonly<Record<string, T>>;
  name: string;
  newName: string;
}): { registration: { name: string } & T; isSameName: boolean } {
  const { entity, registry, name, newName } = params;
  const registration = requireRegistered({ entity, registry, name });

  if (newName === name) {
    return { registration, isSameName: true };
  }

  assertNameIsValid({ entity, name: newName });
  assertNameIsAvailable({ entity, registry, name: newName });

  return { registration, isSameName: false };
}

/**
 * The file's contents as JSON, or `undefined` when the file is not there.
 *
 * Only a syntax error is translated: a read that failed for any other reason —
 * unreadable, a directory, an I/O error — is not something the user fixes by
 * editing the file.
 */
function readJsonFile(file: string): unknown {
  try {
    return extractJsonContent(file);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidShapeError({
        message: `${file}: is not valid JSON`,
      });
    }

    throw error;
  }
}
