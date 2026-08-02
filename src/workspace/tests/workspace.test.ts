import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addWorkspace, listWorkspaces, removeWorkspace } from '../index.ts';
import {
  DuplicateNameError,
  InvalidPathError,
  PathCollisionError,
  UnknownNameError,
  WorkspaceInUseError,
} from '#src/lib/errors/index';
import { GrimoireStore } from '#src/store/index';
import { tempRoot } from '#test-helpers/temp-root';

describe('addWorkspace', () => {
  it('registers a workspace that does not auto-link by default', async () => {
    const store = await newStore();
    const path = await newDirectory('project');

    const { workspace, created } = addWorkspace(store, { name: 'personal', path });

    expect(workspace).toEqual({ name: 'personal', path, autoLink: false });
    expect(created).toBeNull();
    expect(store.loadConfig().workspaces).toEqual({ personal: { path, autoLink: false } });
  });

  it('registers a workspace that auto-links', async () => {
    const store = await newStore();
    const path = await newDirectory('project');

    addWorkspace(store, { name: 'personal', path, autoLink: true });

    expect(store.loadConfig().workspaces.personal).toEqual({ path, autoLink: true });
  });

  it('normalizes the path it writes', async () => {
    const store = await newStore();
    const path = await newDirectory('project');

    expect(addWorkspace(store, { name: 'personal', path: `${path}/` }).workspace.path).toBe(path);
  });

  it('refuses a name that is already registered', async () => {
    const store = await newStore();
    const path = await newDirectory('project');
    const other = await newDirectory('other');

    addWorkspace(store, { name: 'personal', path });

    expectRefusal(
      store,
      () => addWorkspace(store, { name: 'personal', path: other }),
      DuplicateNameError,
    );
  });

  it('refuses a path colliding with a registered repo', async () => {
    const store = await newStore();
    const repo = await newDirectory('repo');
    const path = join(repo, 'skills');

    mkdirSync(path);
    store.saveConfig({ ...store.loadConfig(), repos: { mine: { path: repo, mode: 'read-only' } } });

    const error = expectRefusal(
      store,
      () => addWorkspace(store, { name: 'personal', path }),
      PathCollisionError,
    );

    expect(error.message).toContain('repo "mine"');
  });

  it('refuses a path inside the grimoire store', async () => {
    const store = await newStore();

    store.loadConfig();

    const error = expectRefusal(
      store,
      () => addWorkspace(store, { name: 'personal', path: store.paths.skills }),
      PathCollisionError,
    );

    expect(error.message).toContain('the grimoire store');
  });

  it('refuses a path that is a file', async () => {
    const store = await newStore();
    const file = join(await newDirectory('parent'), 'project.md');

    writeFileSync(file, 'not a directory', 'utf8');

    const error = expectRefusal(
      store,
      () => addWorkspace(store, { name: 'personal', path: file }),
      InvalidPathError,
    );

    expect(error.reason).toBe('not-a-directory');
  });

  // A workspace path plausibly does not exist yet: `~/.claude/skills` appears
  // when the first skill is written there.
  it('creates a missing final segment and reports it', async () => {
    const store = await newStore();
    const path = join(await newDirectory('project'), 'skills');

    const { created } = addWorkspace(store, { name: 'personal', path });

    expect(created).toBe(path);
    expect(existsSync(path)).toBe(true);
  });

  it('refuses a parent that is a file, naming the parent', async () => {
    const store = await newStore();
    const parent = join(await newDirectory('project'), 'skills');
    const path = join(parent, 'nested');

    writeFileSync(parent, 'not a directory', 'utf8');

    const error = expectRefusal(
      store,
      () => addWorkspace(store, { name: 'personal', path }),
      InvalidPathError,
    );

    expect(error).toMatchObject({ reason: 'not-a-directory', path: parent });
  });

  it('refuses a path that is a dangling symlink', async () => {
    const store = await newStore();
    const path = join(await newDirectory('project'), 'skills');

    symlinkSync(join(await newDirectory('gone'), 'target'), path);

    expectRefusal(store, () => addWorkspace(store, { name: 'personal', path }), InvalidPathError);
  });

  it('registers a symlink to a directory without creating anything', async () => {
    const store = await newStore();
    const target = await newDirectory('target');
    const path = join(await newDirectory('project'), 'skills');

    symlinkSync(target, path);

    const { workspace, created } = addWorkspace(store, { name: 'personal', path });

    expect(created).toBeNull();
    expect(workspace.path).toBe(path);
  });

  it('refuses a missing parent without creating anything', async () => {
    const store = await newStore();
    const path = join(await newDirectory('project'), 'typo', 'skills');

    const error = expectRefusal(
      store,
      () => addWorkspace(store, { name: 'personal', path }),
      InvalidPathError,
    );

    expect(error).toMatchObject({ reason: 'missing', path: dirname(path) });
    expect(existsSync(dirname(path))).toBe(false);
  });
});

describe('removeWorkspace', () => {
  it('unregisters the workspace and returns what it removed', async () => {
    const store = await newStore();
    const path = await newDirectory('project');

    addWorkspace(store, { name: 'personal', path, autoLink: true });

    expect(removeWorkspace(store, { name: 'personal' })).toEqual({
      workspace: { name: 'personal', path, autoLink: true },
      cleared: { links: [], clones: [] },
      converted: [],
      collision: null,
    });
    expect(store.loadConfig().workspaces).toEqual({});
    expect(existsSync(path)).toBe(true);
  });

  it('refuses a name that is not registered', async () => {
    const store = await newStore();

    expectRefusal(store, () => removeWorkspace(store, { name: 'nope' }), UnknownNameError);
  });

  it('refuses while a link into the store remains', async () => {
    const store = await newStore();
    const path = await newWorkspace(store, 'personal');

    link({ store, workspacePath: path, skill: 'brainstorm' });

    const error = expectRefusal(
      store,
      () => removeWorkspace(store, { name: 'personal' }),
      WorkspaceInUseError,
    );

    expect(error.links).toEqual(['brainstorm']);
  });

  it('names every link still pointing at the workspace', async () => {
    const store = await newStore();
    const path = await newWorkspace(store, 'personal');

    link({ store, workspacePath: path, skill: 'triage' });
    link({ store, workspacePath: path, skill: 'brainstorm' });

    const error = expectRefusal(
      store,
      () => removeWorkspace(store, { name: 'personal' }),
      WorkspaceInUseError,
    );

    expect(error.message).toBe(
      [
        'workspace "personal" is still in use',
        '  links: brainstorm, triage',
        '  use --hard to clear them',
      ].join('\n'),
    );
  });

  // The name stops resolving the moment the workspace is gone; the path does not.
  it('rewrites a named clone record to carry the path', async () => {
    const store = await newStore();
    const path = await newWorkspace(store, 'personal');

    store.saveState({ deploy: { clones: [{ workspace: 'personal' }] } });

    const { converted, cleared } = removeWorkspace(store, { name: 'personal' });

    expect(converted).toEqual(['deploy']);
    expect(cleared.clones).toEqual([]);
    expect(store.loadState().deploy?.clones).toEqual([{ path }]);
  });

  it('unregisters without a flag while only clone records remain', async () => {
    const store = await newStore();

    await newWorkspace(store, 'personal');
    store.saveState({ deploy: { clones: [{ workspace: 'personal' }] } });

    expect(() => removeWorkspace(store, { name: 'personal' })).not.toThrow();
    expect(store.loadConfig().workspaces).toEqual({});
  });

  it('leaves a clone record naming another workspace alone', async () => {
    const store = await newStore();

    await newWorkspace(store, 'personal');
    await newWorkspace(store, 'work');
    store.saveState({ deploy: { clones: [{ workspace: 'work' }] } });

    const { converted } = removeWorkspace(store, { name: 'personal' });

    expect(converted).toEqual([]);
    expect(store.loadState().deploy?.clones).toEqual([{ workspace: 'work' }]);
  });

  it('clears the links under --hard', async () => {
    const store = await newStore();
    const path = await newWorkspace(store, 'personal');

    link({ store, workspacePath: path, skill: 'brainstorm' });

    const { cleared } = removeWorkspace(store, { name: 'personal', hard: true });

    expect(cleared.links).toEqual(['brainstorm']);
    expect(existsSync(join(path, 'brainstorm'))).toBe(false);
    expect(store.loadConfig().workspaces).toEqual({});
  });

  it('forgets the clone records under --hard', async () => {
    const store = await newStore();

    await newWorkspace(store, 'personal');
    store.saveState({ deploy: { clones: [{ workspace: 'personal' }] } });

    const { cleared, converted } = removeWorkspace(store, { name: 'personal', hard: true });

    expect(cleared.clones).toEqual(['deploy']);
    expect(converted).toEqual([]);
    expect(store.loadState().deploy?.clones).toEqual([]);
  });

  // A clone is a copy living where grimoire is a guest.
  it('leaves the cloned directory on disk under --hard', async () => {
    const store = await newStore();
    const path = await newWorkspace(store, 'personal');
    const clone = join(path, 'deploy');

    mkdirSync(clone);
    store.saveState({ deploy: { clones: [{ workspace: 'personal' }] } });

    removeWorkspace(store, { name: 'personal', hard: true });

    expect(existsSync(clone)).toBe(true);
  });

  // An absolute record keeps resolving once the name is gone, so nothing dangles.
  it('leaves a path-keyed clone record alone under --hard', async () => {
    const store = await newStore();
    const path = await newWorkspace(store, 'personal');

    store.saveState({ deploy: { clones: [{ path: join(path, 'deploy') }] } });

    const { cleared } = removeWorkspace(store, { name: 'personal', hard: true });

    expect(cleared.clones).toEqual([]);
    expect(store.loadState().deploy?.clones).toEqual([{ path: join(path, 'deploy') }]);
  });

  it('unregisters a workspace whose directory is gone', async () => {
    const store = await newStore();
    const path = join(await newDirectory('project'), 'skills');

    addWorkspace(store, { name: 'personal', path });
    rmSync(path, { recursive: true });

    expect(removeWorkspace(store, { name: 'personal' }).workspace.path).toBe(path);
    expect(store.loadConfig().workspaces).toEqual({});
  });

  it('unregisters a workspace whose directory has become a file', async () => {
    const store = await newStore();
    const path = join(await newDirectory('project'), 'skills');

    addWorkspace(store, { name: 'personal', path });
    rmSync(path, { recursive: true });
    writeFileSync(path, 'not a directory', 'utf8');

    expect(removeWorkspace(store, { name: 'personal' }).cleared.links).toEqual([]);
    expect(store.loadConfig().workspaces).toEqual({});
  });

  it('unregisters a workspace whose parent directory has become a file', async () => {
    const store = await newStore();
    const parent = join(await newDirectory('project'), 'claude');
    const path = join(parent, 'skills');

    mkdirSync(path, { recursive: true });
    addWorkspace(store, { name: 'personal', path });
    rmSync(parent, { recursive: true });
    writeFileSync(parent, 'not a directory', 'utf8');

    expect(removeWorkspace(store, { name: 'personal' }).cleared.links).toEqual([]);
    expect(store.loadConfig().workspaces).toEqual({});
  });
});

/**
 * The pairing `add` refuses, written straight to config.json — which is how it
 * arrives in practice: a hand-edit, or a `~/.claude` repointed into the repo
 * that versions it after both were registered.
 */
describe('removeWorkspace on a path that collides', () => {
  it("reports a path that has become a repo's and clears no links from it", async () => {
    const store = await newStore();
    const { repo, path } = await registerCollidingWithRepo(store);

    link({ store, workspacePath: path, skill: 'brainstorm' });

    const { collision, cleared } = removeWorkspace(store, { name: 'personal', hard: true });

    expect(collision).toMatchObject({ kind: 'registered', registry: 'repos', name: 'dots', path: repo });
    expect(cleared.links).toEqual([]);
    expect(existsSync(join(path, 'brainstorm'))).toBe(true);
  });

  // Refusing would leave no way to apply the fix a collision calls for.
  it('surrenders the name rather than refusing over links it will not clear', async () => {
    const store = await newStore();
    const { path } = await registerCollidingWithRepo(store);

    link({ store, workspacePath: path, skill: 'brainstorm' });

    expect(() => removeWorkspace(store, { name: 'personal' })).not.toThrow();
    expect(store.loadConfig().workspaces).toEqual({});
    expect(existsSync(join(path, 'brainstorm'))).toBe(true);
  });

  it('reports a path sitting inside the grimoire store', async () => {
    const store = await newStore();

    store.saveConfig({
      ...store.loadConfig(),
      workspaces: { personal: { path: store.paths.skills, autoLink: false } },
    });

    expect(removeWorkspace(store, { name: 'personal' }).collision).toMatchObject({
      kind: 'grimoire-home',
      relation: 'inside',
    });
  });

  // The records are grimoire's own; only the directory is off limits.
  it('still rewrites the clone records', async () => {
    const store = await newStore();
    const { path } = await registerCollidingWithRepo(store);

    store.saveState({ deploy: { clones: [{ workspace: 'personal' }] } });

    expect(removeWorkspace(store, { name: 'personal' }).converted).toEqual(['deploy']);
    expect(store.loadState().deploy?.clones).toEqual([{ path }]);
  });
});

describe('listWorkspaces', () => {
  it('is empty on a fresh store', async () => {
    expect(listWorkspaces(await newStore())).toEqual([]);
  });

  it('sorts by name', async () => {
    const store = await newStore();

    addWorkspace(store, { name: 'work', path: await newDirectory('work') });
    addWorkspace(store, { name: 'archive', path: await newDirectory('archive') });
    addWorkspace(store, { name: 'personal', path: await newDirectory('personal') });

    expect(listWorkspaces(store).map(({ name }) => name)).toEqual(['archive', 'personal', 'work']);
  });
});

async function newStore(): Promise<GrimoireStore> {
  return new GrimoireStore(await tempRoot());
}

/**
 * A directory to register, in its own temp root rather than under the store's —
 * a path inside the store is a collision by design.
 */
async function newDirectory(name: string): Promise<string> {
  const path = join(await tempRoot(), name);

  mkdirSync(path, { recursive: true });

  return path;
}

/** A registered workspace, returning the path it was registered at. */
async function newWorkspace(store: GrimoireStore, name: string): Promise<string> {
  return addWorkspace(store, { name, path: await newDirectory(name) }).workspace.path;
}

/**
 * A workspace `personal` registered inside repo `dots`, written straight to
 * config.json because `addWorkspace` is what refuses the pairing.
 */
async function registerCollidingWithRepo(store: GrimoireStore): Promise<{ repo: string; path: string }> {
  const repo = await newDirectory('repo');
  const path = join(repo, 'skills');

  mkdirSync(path);
  store.saveConfig({
    ...store.loadConfig(),
    repos: { dots: { path: repo, mode: 'read-only' } },
    workspaces: { personal: { path, autoLink: false } },
  });

  return { repo, path };
}

/** What the `link` command will write, hand-built — it does not exist yet. */
function link(fixture: { store: GrimoireStore; workspacePath: string; skill: string }): void {
  const target = join(fixture.store.paths.skills, fixture.skill);

  mkdirSync(target, { recursive: true });
  symlinkSync(target, join(fixture.workspacePath, fixture.skill));
}

/**
 * Asserts the operation threw the expected refusal and that neither config.json
 * nor .state.json changed, since every check runs before anything is written.
 */
function expectRefusal<T extends Error>(
  store: GrimoireStore,
  operation: () => unknown,
  expected: new (...args: never[]) => T,
): T {
  const before = [readStoreFile(store.paths.config), readStoreFile(store.paths.state)];

  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(expected);
    expect([readStoreFile(store.paths.config), readStoreFile(store.paths.state)]).toEqual(before);

    return error as T;
  }

  throw new Error(`expected a ${expected.name}`);
}

/** The raw bytes of a store file, or `null` when it has never been written. */
function readStoreFile(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
