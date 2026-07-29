import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_MODE, addRepo, listRepos, removeRepo } from '../index.ts';
import {
  DuplicateNameError,
  InvalidPathError,
  PathCollisionError,
  UnknownNameError,
} from '#src/lib/errors/index';
import { GrimoireStore } from '#src/store/index';
import { tempRoot } from '#test-helpers/temp-root';

describe('addRepo', () => {
  it('registers a repo at the default mode', async () => {
    const store = await newStore();
    const path = await newDirectory('skills');

    const { repo } = addRepo(store, { name: 'personal', path });

    expect(repo).toEqual({ name: 'personal', path, mode: DEFAULT_REPO_MODE });
    expect(store.loadConfig().repos).toEqual({ personal: { path, mode: 'read-only' } });
  });

  it('registers a repo at an explicit mode', async () => {
    const store = await newStore();
    const path = await newDirectory('skills');

    addRepo(store, { name: 'personal', path, mode: 'read-write' });

    expect(store.loadConfig().repos.personal).toEqual({ path, mode: 'read-write' });
  });

  it('normalizes the path it writes', async () => {
    const store = await newStore();
    const path = await newDirectory('skills');

    const { repo } = addRepo(store, { name: 'personal', path: `${path}/` });

    expect(repo.path).toBe(path);
  });

  it('refuses a name that is already registered', async () => {
    const store = await newStore();
    const path = await newDirectory('skills');
    const other = await newDirectory('other');

    addRepo(store, { name: 'personal', path });

    expectRefusal(store, () => addRepo(store, { name: 'personal', path: other }), DuplicateNameError);
  });

  it('refuses a path that does not exist', async () => {
    const store = await newStore();
    const missing = join(await newDirectory('parent'), 'nope');

    const error = expectRefusal(
      store,
      () => addRepo(store, { name: 'personal', path: missing }),
      InvalidPathError,
    );

    expect(error.reason).toBe('missing');
  });

  it('refuses a path that is a file', async () => {
    const store = await newStore();
    const file = join(await newDirectory('parent'), 'skills.md');

    writeFileSync(file, 'not a directory', 'utf8');

    const error = expectRefusal(
      store,
      () => addRepo(store, { name: 'personal', path: file }),
      InvalidPathError,
    );

    expect(error.reason).toBe('not-a-directory');
  });

  it('refuses a path colliding with a registered workspace', async () => {
    const store = await newStore();
    const workspace = await newDirectory('project');
    const path = join(workspace, 'skills');

    mkdirSync(path);
    store.saveConfig({
      ...store.loadConfig(),
      workspaces: { app: { path: workspace, autoLink: true } },
    });

    const error = expectRefusal(
      store,
      () => addRepo(store, { name: 'personal', path }),
      PathCollisionError,
    );

    expect(error.message).toContain('workspace "app"');
  });

  // The store root is the temp root here, so a path under it is the case to
  // construct.
  it('refuses a path inside the grimoire store', async () => {
    const store = await newStore();

    // The scaffold is created on first load, which is what makes the store's
    // own subdirectory an existing path rather than a missing one.
    store.loadConfig();

    const error = expectRefusal(
      store,
      () => addRepo(store, { name: 'personal', path: store.paths.skills }),
      PathCollisionError,
    );

    expect(error.message).toContain('the grimoire store');
  });

  describe('the .git warning', () => {
    it('fires when nothing is found at the path or above it', async () => {
      const store = await newStore();
      const path = await newDirectory('skills');

      const { warning } = addRepo(store, { name: 'personal', path });

      expect(warning).toEqual({ kind: 'no-git', path });
    });

    it('stays quiet when .git sits at the path itself', async () => {
      const store = await newStore();
      const path = await newDirectory('skills');

      mkdirSync(join(path, '.git'));

      expect(addRepo(store, { name: 'personal', path }).warning).toBeNull();
    });

    // A repo is registered at its skills directory, not at its git root, so the
    // walk goes upward.
    it('stays quiet when .git sits at an ancestor', async () => {
      const store = await newStore();
      const root = await newDirectory('checkout');
      const path = join(root, 'agents', 'skills');

      mkdirSync(join(root, '.git'));
      mkdirSync(path, { recursive: true });

      expect(addRepo(store, { name: 'personal', path }).warning).toBeNull();
    });
  });
});

describe('removeRepo', () => {
  it('unregisters the repo and returns what it removed', async () => {
    const store = await newStore();
    const path = await newDirectory('skills');

    addRepo(store, { name: 'personal', path, mode: 'read-write' });

    expect(removeRepo(store, 'personal')).toEqual({ name: 'personal', path, mode: 'read-write' });
    expect(store.loadConfig().repos).toEqual({});
  });

  it('leaves the repo directory on disk', async () => {
    const store = await newStore();
    const path = await newDirectory('skills');
    const skill = join(path, 'brainstorm.md');

    writeFileSync(skill, '# brainstorm', 'utf8');
    addRepo(store, { name: 'personal', path });
    removeRepo(store, 'personal');

    expect(existsSync(skill)).toBe(true);
  });

  it('refuses a name that is not registered', async () => {
    const store = await newStore();

    expectRefusal(store, () => removeRepo(store, 'nope'), UnknownNameError);
  });

  it('leaves the other repos alone', async () => {
    const store = await newStore();

    addRepo(store, { name: 'personal', path: await newDirectory('personal') });
    addRepo(store, { name: 'team', path: await newDirectory('team') });
    removeRepo(store, 'personal');

    expect(Object.keys(store.loadConfig().repos)).toEqual(['team']);
  });
});

describe('listRepos', () => {
  it('is empty on a fresh store', async () => {
    expect(listRepos(await newStore())).toEqual([]);
  });

  it('sorts by name', async () => {
    const store = await newStore();

    addRepo(store, { name: 'team', path: await newDirectory('team') });
    addRepo(store, { name: 'archive', path: await newDirectory('archive') });
    addRepo(store, { name: 'personal', path: await newDirectory('personal') });

    expect(listRepos(store).map(({ name }) => name)).toEqual(['archive', 'personal', 'team']);
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

/**
 * Asserts the operation threw the expected refusal and that config.json is
 * byte-identical afterwards, since every check runs before the save.
 */
function expectRefusal<T extends Error>(
  store: GrimoireStore,
  operation: () => unknown,
  expected: new (...args: never[]) => T,
): T {
  const before = readConfigFile(store);

  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(expected);
    expect(readConfigFile(store)).toBe(before);

    return error as T;
  }

  throw new Error(`expected a ${expected.name}`);
}

/** The raw bytes of config.json, or `null` when it has never been written. */
function readConfigFile(store: GrimoireStore): string | null {
  return existsSync(store.paths.config) ? readFileSync(store.paths.config, 'utf8') : null;
}
