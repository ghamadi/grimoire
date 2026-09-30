import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { extractJsonContent, writeAtomic } from '../../lib/utils/files.ts';
import type { GrimoireStore } from './entity.ts';
import { StoreState, type CloneRecord } from './value-objects/store-state.ts';
import { DuplicateNameError } from '../../lib/errors/duplicate-name.ts';
import { toRegisteredPath } from './helpers/registered-path.ts';
import {
  CollidingRegistrationError,
  EntityNotFoundError,
  InvalidWorkspaceNameError,
  PathCollisionError,
} from '../../lib/errors/index.ts';
import { join, matchesGlob } from 'node:path';
import { InvalidShapeError } from '../../lib/errors/invalid-shape.ts';
import {
  findDanglingStoreLinks,
  findStoreLinks,
  type DanglingStoreLink,
  type StoreLink,
} from '#src/domains/grimoire-store/helpers/store-links';
import { Skill } from '../skill/entity.ts';
import { copyTree, movePath } from '#src/lib/fs';
import { Workspace } from '#src/domains/workspace/index';
import { trashBinName } from '#src/domains/grimoire-store/helpers/trash';
import { normalizePath, relate } from '#src/lib/paths';

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
  /**
   * `<workspace path or recorded path>/<skill>`, normalized — or `undefined` when `record`
   * names a workspace that is not registered.
   */
  path: string | undefined;
};

/** A workspace as `state.json` holds it, carrying the name it is filed under. */
export type RegisteredWorkspace = {
  name: string;
  path: string;
  autoLink: boolean;
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

    if (!Workspace.isValidName(name)) {
      throw new InvalidWorkspaceNameError({ name });
    }

    const storeState = this.loadState();

    if (Object.hasOwn(storeState.workspacesRegistry, name)) {
      throw new DuplicateNameError({ name });
    }

    const collision = this.store.findCollisionWith(params.path);

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
    const workspace = findRegisteredWorkspace(this.loadState(), name);

    if (!workspace) {
      throw new EntityNotFoundError({ entity: 'workspace', name });
    }

    return workspace;
  }

  /**
   * Drops a workspace from the registry and returns what it dropped.
   *
   * The registration only: the directory, whatever it holds, and any clone
   * record naming the workspace all outlive this call. A caller that has to
   * settle those reads them through the name first, because the name stops
   * resolving here.
   *
   * @throws EntityNotFoundError if no workspace is registered under that name.
   */
  unregisterWorkspace(name: string): RegisteredWorkspace {
    const storeState = this.loadState();
    const workspace = findRegisteredWorkspace(storeState, name);

    if (!workspace) {
      throw new EntityNotFoundError({ entity: 'workspace', name });
    }

    this.saveState(storeState.withoutWorkspace(name));

    return workspace;
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
   * A record naming a workspace that is no longer registered resolves nowhere
   * and is left out. The recorded path is joined as-is, not normalized, so
   * `origin` prints the path the action takes.
   */
  listSkillClones(name: string): SkillClone[] {
    const state = this.loadState();

    return state.clonesOfSkill(name).flatMap((record): SkillClone[] => {
      if ('path' in record) {
        return [{ origin: record.path, path: join(record.path, name), record }];
      }

      const workspace = findRegisteredWorkspace(state, record.workspace);

      return workspace ? [{ origin: record.workspace, path: join(workspace.path, name), record }] : [];
    });
  }

  /**
   * Every clone record in `state.json`, by skill name, then record order. Unlike
   * `listSkillClones`, a record naming an unregistered workspace is kept, with no path.
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

          const workspace = findRegisteredWorkspace(state, record.workspace);

          return { skill, record, path: workspace && join(workspace.path, skill) };
        }),
      );
  }

  /**
   * The skill's recorded clone whose directory is `<directory>/<skill>`, by either record arm,
   * compared canonically; the first in record order, or `undefined`. Built on `listSkillClones`,
   * so a record naming an unregistered workspace never matches.
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

  /** Drops the skill's whole entry from `state.json`, writing nothing when it has none. */
  forgetSkill(name: string): void {
    const state = this.loadState();

    if (!Object.hasOwn(state.skillsByName, name)) {
      return;
    }

    this.saveState(state.withoutSkill(name));
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
 * Refuses the whole registry over the first entry whose path touches the store.
 *
 * Sorted, so a registry holding two of them names the same one every run rather
 * than whichever the object happened to yield first.
 */
function assertNoCollidingRegistrations(query: { state: StoreState; store: GrimoireStore }): void {
  const registrations = Object.entries(query.state.workspacesRegistry).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [name, { path }] of registrations) {
    const collision = query.store.findCollisionWith(path);

    if (collision) {
      throw new CollidingRegistrationError({
        name,
        path,
        collision,
        storeState: query.store.paths.state,
      });
    }
  }
}

/**
 * The entry filed under `name`, or `undefined`.
 *
 * `hasOwn` rather than a truthiness check: `workspaces['toString']` answers
 * with the method every object inherits.
 */
function findRegisteredWorkspace(config: StoreState, name: string): RegisteredWorkspace | undefined {
  const workspace = Object.hasOwn(config.workspacesRegistry, name)
    ? config.workspacesRegistry[name]
    : undefined;

  return workspace && { name, ...workspace };
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
