import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrimoireStore, type Config } from '../index.ts';
import { StoreFileError } from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';

describe('loadConfig', () => {
  it('returns the documented defaults on a fresh root', async () => {
    const store = new GrimoireStore(await tempRoot());

    expect(store.loadConfig()).toEqual({ repos: {}, workspaces: {}, ignore: ['.DS_Store'] });
  });

  // config.json is yours to hand-edit, and an absent key has exactly one
  // unambiguous meaning.
  it('fills in absent top-level keys', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "repos": {} }');

    expect(store.loadConfig()).toEqual({ repos: {}, workspaces: {}, ignore: ['.DS_Store'] });
  });

  // An explicit empty list is the user's stated choice, not an absent key —
  // only a missing key takes the default.
  it('loads an explicit empty ignore list as empty', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "ignore": [] }');

    expect(store.loadConfig().ignore).toEqual([]);
  });

  it('throws on invalid JSON, naming the file', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "repos": ');

    const error = loadConfigError(store);

    expect(error).toBeInstanceOf(StoreFileError);
    expect(error.reason).toBe('invalid-json');
    expect(error.message).toContain(store.paths.config);
  });

  it('throws on a wrong-typed field', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "ignore": "DS_Store" }');

    const error = loadConfigError(store);

    expect(error).toBeInstanceOf(StoreFileError);
    expect(error.reason).toBe('invalid-shape');
    expect(error.message).toContain(store.paths.config);
  });

  // A stripped key would be silently gone from disk on the next save, so a
  // typo has to be named back to you at the moment you make it.
  it('rejects an unrecognized top-level key and names it', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "repo": {} }');

    const error = loadConfigError(store);

    expect(error.reason).toBe('invalid-shape');
    expect(error.message).toContain('repo');
  });

  it('rejects an unknown repo mode', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "repos": { "personal": { "path": "/repos/personal", "mode": "rw" } } }');

    expect(loadConfigError(store).reason).toBe('invalid-shape');
  });

  it('expands a workspace path written with a tilde', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "workspaces": { "personal": { "path": "~/x", "autoLink": false } } }');

    expect(store.loadConfig().workspaces.personal?.path).toBe(join(homedir(), 'x'));
  });

  it('expands a repo path written with a tilde', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "repos": { "personal": { "path": "~/x", "mode": "read-only" } } }');

    expect(store.loadConfig().repos.personal?.path).toBe(join(homedir(), 'x'));
  });

  it('trims a padded path', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "workspaces": { "personal": { "path": "  /c/d  ", "autoLink": false } } }');

    expect(store.loadConfig().workspaces.personal?.path).toBe('/c/d');
  });

  it('collapses parent segments and trailing separators', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(
      store,
      '{ "workspaces": { "personal": { "path": "/a/other/../app/", "autoLink": false } } }',
    );

    expect(store.loadConfig().workspaces.personal?.path).toBe('/a/app');
  });

  // Resolving one against the cwd would make the same file mean different
  // directories depending on where grimoire ran.
  it('rejects a relative path, naming the entry', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeConfig(store, '{ "workspaces": { "personal": { "path": "skills/mine", "autoLink": false } } }');

    const error = loadConfigError(store);

    expect(error.reason).toBe('invalid-shape');
    expect(error.message).toContain('personal');
  });
});

describe('saveConfig', () => {
  it('round-trips a fully populated config', async () => {
    const store = new GrimoireStore(await tempRoot());
    const config: Config = {
      repos: {
        personal: { path: '/repos/personal', mode: 'read-write' },
        team: { path: '/repos/team', mode: 'read-only' },
      },
      workspaces: {
        app: { path: '/projects/app', autoLink: true },
      },
      ignore: ['.DS_Store'],
    };

    store.saveConfig(config);

    expect(store.loadConfig()).toEqual(config);
  });

  it('throws on an invalid config without writing anything', async () => {
    const store = new GrimoireStore(await tempRoot());
    const invalid = { repos: {}, workspaces: {}, ignore: 'DS_Store' } as unknown as Config;

    expect(() => {
      store.saveConfig(invalid);
    }).toThrow();

    expect(existsSync(store.paths.config)).toBe(false);
  });

  it('leaves the previous file intact when validation fails', async () => {
    const store = new GrimoireStore(await tempRoot());
    const config: Config = { repos: {}, workspaces: {}, ignore: ['.DS_Store'] };

    store.saveConfig(config);

    expect(() => {
      store.saveConfig({ ignore: [1] } as unknown as Config);
    }).toThrow();

    expect(store.loadConfig()).toEqual(config);
  });
});

/** Puts raw text on disk as config.json, bypassing every validation. */
function writeConfig(store: GrimoireStore, contents: string): void {
  writeFileSync(store.paths.config, contents, 'utf8');
}

/** Asserts `loadConfig` threw a `StoreFileError` and hands it back. */
function loadConfigError(store: GrimoireStore): StoreFileError {
  try {
    store.loadConfig();
  } catch (error) {
    expect(error).toBeInstanceOf(StoreFileError);
    return error as StoreFileError;
  }

  throw new Error('expected loadConfig to throw');
}
