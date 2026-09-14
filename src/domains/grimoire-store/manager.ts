import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { extractJsonContent, writeAtomic } from '../../lib/utils/files.ts';
import type { GrimoireStore } from './entity.ts';
import { StoreState } from './value-objects/store-state.ts';
import { DuplicateNameError } from '../../lib/errors/duplicate-name.ts';
import { toRegisteredPath } from './helpers/registered-path.ts';
import {
  CollidingRegistrationError,
  EntityNotFoundError,
  PathCollisionError,
} from '../../lib/errors/index.ts';
import { join } from 'node:path';
import { InvalidShapeError } from '../../lib/errors/invalid-shape.ts';
import { findStoreLinks, type StoreLink } from '#src/domains/grimoire-store/helpers/store-links';
import { Skill } from '../skill/entity.ts';

type RegisterWorkspaceParams = {
  name: string;
  path: string;
  autoLink?: boolean;
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
   * registry this manager owns, and the skills root it is scanned against never
   * leaves.
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
   * The store's path for a skill.
   * @throws EntityNotFoundError if the store does not hold it.
   */
  requireSkillPath(name: string) {
    this.ensureLayout();
    const path = join(this.store.paths.skills, name);
    if (!existsSync(path)) {
      throw new EntityNotFoundError({ entity: 'skill', name });
    }
    return path;
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
