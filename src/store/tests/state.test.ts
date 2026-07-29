import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GrimoireStore, type State } from '../index.ts';
import { StoreFileError } from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';

describe('loadState', () => {
  it('returns an empty state on a fresh root', async () => {
    const store = new GrimoireStore(await tempRoot());

    expect(store.loadState()).toEqual({});
  });

  it('throws on invalid JSON, naming the file', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeState(store, '{ "shipper": ');

    const error = loadStateError(store);

    expect(error.reason).toBe('invalid-json');
    expect(error.message).toContain(store.paths.state);
  });

  // ARCHITECTURE.md: one directory never collects two records.
  it('rejects a clone entry carrying both workspace and path', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeState(store, '{ "shipper": { "clones": [{ "workspace": "app", "path": "/projects/app" }] } }');

    const error = loadStateError(store);

    expect(error.reason).toBe('invalid-shape');
    expect(error.message).toContain('exactly one of "workspace" or "path"');
  });

  // The pre-rename shape, where a clone was a bare workspace name. It must fail
  // loudly rather than load as something else.
  it('rejects a bare-string clone entry', async () => {
    const store = new GrimoireStore(await tempRoot());

    writeState(store, '{ "shipper": { "clones": ["personal"] } }');

    const error = loadStateError(store);

    expect(error.reason).toBe('invalid-shape');
    expect(error.message).toContain('exactly one of "workspace" or "path"');
  });
});

describe('saveState', () => {
  it('round-trips both clone forms and an uncloned skill', async () => {
    const store = new GrimoireStore(await tempRoot());
    const state: State = {
      shipper: { clones: [{ workspace: 'app' }] },
      linter: { clones: [{ path: '/projects/one-off' }] },
      drafting: { clones: [] },
    };

    store.saveState(state);

    expect(store.loadState()).toEqual(state);
  });

  // TypeScript lets `{ workspace, path }` through: excess-property checking
  // against a union accepts any key present in any arm. The strict arms are what
  // reject it, and only at save time — so the guard has to be tested here.
  it('leaves the previous file intact when validation fails', async () => {
    const store = new GrimoireStore(await tempRoot());
    const state: State = { shipper: { clones: [{ workspace: 'app' }] } };

    store.saveState(state);

    expect(() => {
      store.saveState({ shipper: { clones: [{ workspace: 'app', path: '/x' }] } });
    }).toThrow();

    expect(store.loadState()).toEqual(state);
  });
});

/** Puts raw text on disk as .state.json, bypassing every validation. */
function writeState(store: GrimoireStore, contents: string): void {
  writeFileSync(store.paths.state, contents, 'utf8');
}

/** Asserts `loadState` threw a `StoreFileError` and hands it back. */
function loadStateError(store: GrimoireStore): StoreFileError {
  try {
    store.loadState();
  } catch (error) {
    expect(error).toBeInstanceOf(StoreFileError);
    return error as StoreFileError;
  }

  throw new Error('expected loadState to throw');
}
