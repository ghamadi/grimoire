import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { Workspace } from '#src/domains/workspace/index';
import { CollidingRegistrationError, InvalidShapeError } from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';
import { createListWorkspacesUseCase } from '../factory.ts';

describe('list-workspaces-use-case factory', () => {
  describe('the use-case it returns', () => {
    it('lists nothing when the store has never been written to', async () => {
      const { listWorkspaces } = await newUseCase();

      expect(listWorkspaces()).toEqual([]);
    });

    it('lists nothing when a store that holds skills has no workspace', async () => {
      const { listWorkspaces, store } = await newUseCase();

      mkdirSync(join(store.paths.skills, 'brainstorm'), { recursive: true });

      expect(listWorkspaces()).toEqual([]);
    });

    it('lists every registered workspace', async () => {
      const { listWorkspaces, register } = await newUseCase();

      register('personal');
      register('work');
      register('archive');

      expect(listWorkspaces().map(({ name }) => name)).toEqual(['archive', 'personal', 'work']);
    });

    // A registry read at construction would report the state the CLI started in,
    // which is the state before the command that just ran.
    it('reads the registry on each call rather than at construction', async () => {
      const { listWorkspaces, register } = await newUseCase();

      expect(listWorkspaces()).toEqual([]);

      register('personal');

      expect(listWorkspaces().map(({ name }) => name)).toEqual(['personal']);
    });

    // A store manager captured at call time rather than at construction would let
    // two use cases built from different stores read whichever ran last.
    it('reads the store manager it was built with', async () => {
      const first = await newUseCase();
      const second = await newUseCase();

      first.register('personal');

      expect(second.listWorkspaces()).toEqual([]);
    });

    // Every object answers to `toString`, so a registry walked through a plain
    // lookup reports a value for names nothing was ever registered under.
    it('lists a name that an object inherits from its prototype, and only that name', async () => {
      const { listWorkspaces, register } = await newUseCase();

      register('toString');

      expect(listWorkspaces().map(({ name }) => name)).toEqual(['toString']);
    });

    it('hands back an array the caller can sort without changing the next answer', async () => {
      const { listWorkspaces, register } = await newUseCase();

      register('archive');
      register('personal');

      listWorkspaces().reverse().pop();

      expect(listWorkspaces().map(({ name }) => name)).toEqual(['archive', 'personal']);
    });
  });

  describe('the order it lists in', () => {
    // state.json is an object, so its order is whenever each workspace happened
    // to be registered — which is not an order the user has any reason to expect.
    it('sorts by name rather than by registration order', async () => {
      const { listWorkspaces, register } = await newUseCase();

      register('work');
      register('archive');
      register('personal');

      expect(listWorkspaces().map(({ name }) => name)).toEqual(['archive', 'personal', 'work']);
    });

    it('sorts by name rather than by code point, so case does not split the list', async () => {
      const { listWorkspaces, register } = await newUseCase();

      register('Work');
      register('archive');

      expect(listWorkspaces().map(({ name }) => name)).toEqual(['archive', 'Work']);
    });
  });

  describe('the workspaces it returns', () => {
    it('carries the name, path, and auto-link flag each was registered with', async () => {
      const { listWorkspaces, register } = await newUseCase();
      const path = register('personal', { autoLink: true });

      expect(listWorkspaces()).toEqual([new Workspace({ name: 'personal', path, autoLink: true })]);
    });

    it('carries a manual workspace as manual', async () => {
      const { listWorkspaces, register } = await newUseCase();

      register('personal');

      expect(listWorkspaces()[0]?.autoLink).toBe(false);
    });

    it('returns Workspace entities rather than plain records', async () => {
      const { listWorkspaces, register } = await newUseCase();

      register('personal');

      expect(listWorkspaces()[0]).toBeInstanceOf(Workspace);
    });

    // The registration normalizes, and this is what the caller prints, so the
    // listing has to read back the path state.json holds.
    it('carries the path the registration normalized rather than the one typed', async () => {
      const { listWorkspaces, manager, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);
      manager.registerWorkspace({ name: 'personal', path: `${path}/../project/` });

      expect(listWorkspaces()[0]?.path).toBe(path);
    });
  });

  /**
   * Registration is the whole answer here. A workspace that can no longer be
   * written into is exactly the one the user needs to see in order to fix it, so
   * none of these may drop out of the listing.
   */
  describe('registrations the filesystem no longer agrees with', () => {
    it('lists a workspace whose directory has been deleted since', async () => {
      const { listWorkspaces, register } = await newUseCase();
      const path = register('personal');

      rmSync(path, { recursive: true });

      const [workspace] = listWorkspaces();

      expect(workspace?.name).toBe('personal');
      expect(workspace?.getDirectoryAccess()).toBe('unresolvable');
    });

    it('lists a workspace whose path is now held by a file', async () => {
      const { listWorkspaces, register } = await newUseCase();
      const path = register('personal');

      rmSync(path, { recursive: true });
      writeFileSync(path, 'not a directory', 'utf8');

      expect(listWorkspaces()[0]?.getDirectoryAccess()).toBe('unresolvable');
    });
  });

  describe('refusals', () => {
    it('refuses a state.json that is not valid JSON', async () => {
      const { listWorkspaces, store } = await newUseCase();

      mkdirSync(store.paths.root, { recursive: true });
      writeFileSync(store.paths.state, '{ workspaces: }', 'utf8');

      expect(() => listWorkspaces()).toThrow(InvalidShapeError);
    });

    it('refuses a state.json whose shape the schema rejects', async () => {
      const { listWorkspaces, writeRegistry } = await newUseCase();

      writeRegistry({ personal: { path: 'project/skills', autoLink: false } });

      expect(() => listWorkspaces()).toThrow(InvalidShapeError);
    });

    // Unlike a path that is merely unreachable, this is an illegal state that the StoreManager refuses to load.
    it('refuses a registered path that touches the store', async () => {
      const { listWorkspaces, store, writeRegistry } = await newUseCase();

      writeRegistry({ personal: { path: join(store.paths.skills, 'personal'), autoLink: false } });

      expect(() => listWorkspaces()).toThrow(CollidingRegistrationError);
    });
  });
});

type RegisteredEntry = { path: string; autoLink: boolean };

async function newUseCase(): Promise<{
  listWorkspaces: ReturnType<typeof createListWorkspacesUseCase>;
  /** Registers a workspace over a directory of the same name, and returns its path. */
  register: (name: string, options?: { autoLink?: boolean }) => string;
  /** The registry as state.json holds it, bypassing everything that vets one. */
  writeRegistry: (workspaces: Record<string, RegisteredEntry>) => void;
  manager: GrimoireStoreManager;
  store: GrimoireStore;
  root: string;
}> {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));
  const manager = new GrimoireStoreManager(store);

  function register(name: string, options: { autoLink?: boolean } = {}): string {
    const path = join(root, name);

    mkdirSync(path, { recursive: true });
    manager.registerWorkspace({ name, path, autoLink: options.autoLink });

    return path;
  }

  function writeRegistry(workspaces: Record<string, RegisteredEntry>): void {
    mkdirSync(store.paths.root, { recursive: true });
    writeFileSync(store.paths.state, JSON.stringify({ workspaces }), 'utf8');
  }

  return {
    listWorkspaces: createListWorkspacesUseCase({ storeManager: manager }),
    register,
    writeRegistry,
    manager,
    store,
    root,
  };
}
