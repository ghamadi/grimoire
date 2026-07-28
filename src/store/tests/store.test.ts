import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrimoireStore } from '../index.ts';
import { tempRoot } from '#test-helpers/temp-root';

describe('paths', () => {
  it('maps every store location under the root', () => {
    const root = '/tmp/store-root';

    expect(new GrimoireStore(root).paths).toEqual({
      root,
      skills: join(root, 'skills'),
      trash: join(root, '.trash'),
      backup: join(root, '.backup'),
      config: join(root, 'config.json'),
      state: join(root, '.state.json'),
    });
  });

  // The state file is dot-prefixed and the config file is not. Guards against a
  // regression to the pre-rename `state.json`.
  it('dot-prefixes the state file but not the config file', () => {
    const { config, state } = new GrimoireStore('/tmp/store-root').paths;

    expect(config.endsWith('/config.json')).toBe(true);
    expect(state.endsWith('/.state.json')).toBe(true);
  });

  // Constructing a store is pure path arithmetic; scaffolding belongs to the
  // methods that go on to read or write. Guards against `ensureLayout` drifting
  // into the constructor, which would make `new GrimoireStore` a mkdir.
  it('touches no filesystem on construction', async () => {
    const root = join(await tempRoot(), 'not-created-yet');

    new GrimoireStore(root);

    expect(existsSync(root)).toBe(false);
  });
});

/**
 * `ensureLayout` is private, so the invariant it exists for — every public entry
 * point finds a scaffold, there being no `init` command — is pinned through the
 * public methods rather than by calling it.
 */
describe('store layout', () => {
  const entryPoints: [string, (store: GrimoireStore) => void][] = [
    [
      'loadConfig',
      (store) => {
        store.loadConfig();
      },
    ],
    [
      'saveConfig',
      (store) => {
        store.saveConfig({ repos: {}, workspaces: {}, ignore: [] });
      },
    ],
    [
      'loadState',
      (store) => {
        store.loadState();
      },
    ],
    [
      'saveState',
      (store) => {
        store.saveState({});
      },
    ],
  ];

  it.each(entryPoints)('%s creates skills, .trash and .backup', async (_name, run) => {
    const store = new GrimoireStore(await tempRoot());

    run(store);

    const { skills, trash, backup } = store.paths;

    for (const dir of [skills, trash, backup]) {
      expect(statSync(dir).isDirectory()).toBe(true);
    }
  });

  it('creates no store files and no .trash/skills', async () => {
    const store = new GrimoireStore(await tempRoot());

    store.loadConfig();

    const { config, state, trash } = store.paths;

    expect(existsSync(config)).toBe(false);
    expect(existsSync(state)).toBe(false);
    expect(readdirSync(trash)).toEqual([]);
  });

  it('is idempotent', async () => {
    const store = new GrimoireStore(await tempRoot());

    store.loadConfig();
    const before = readdirSync(store.paths.root).sort();

    expect(() => {
      store.loadConfig();
    }).not.toThrow();
    expect(readdirSync(store.paths.root).sort()).toEqual(before);
  });
});
