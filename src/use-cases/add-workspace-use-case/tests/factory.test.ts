import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { Workspace } from '#src/domains/workspace/index';
import {
  DuplicateNameError,
  GrimoireError,
  InvalidPathError,
  PathCollisionError,
} from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';
import { createAddWorkspaceUseCase } from '../factory.ts';

describe('add-workspace-use-case factory', () => {
  describe('the use-case it returns', () => {
    it('registers each workspace it is called with, keeping the earlier ones', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const personal = join(root, 'personal');
      const work = join(root, 'work');

      mkdirSync(personal);
      mkdirSync(work);

      addWorkspace({ name: 'personal', path: personal, autoLink: true });
      addWorkspace({ name: 'work', path: work });

      expect(manager.getRegistry().workspaces).toEqual({
        personal: { path: personal, autoLink: true },
        work: { path: work, autoLink: false },
      });
    });

    // A store manager captured at call time rather than at construction would let
    // two use cases built from different stores write to whichever ran last.
    it('registers against the store manager it was built with', async () => {
      const first = await newUseCase();
      const second = await newUseCase();
      const path = join(first.root, 'project');

      mkdirSync(path);
      first.addWorkspace({ name: 'personal', path });

      expect(second.manager.getRegistry().workspaces).toEqual({});
    });

    // Every object answers to `toString`, so a registry read through a plain
    // lookup reports the name as taken before anything is registered under it.
    it('registers a name that an object inherits from its prototype', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);

      expect(addWorkspace({ name: 'toString', path }).workspace.name).toBe('toString');
      expect(manager.getRegistry().workspaces).toEqual({ toString: { path, autoLink: false } });
    });
  });

  describe('the workspace it returns', () => {
    it('carries the name it was given', async () => {
      const { addWorkspace, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);

      expect(addWorkspace({ name: 'personal', path }).workspace.name).toBe('personal');
    });

    it('is a Workspace entity rather than a plain record', async () => {
      const { addWorkspace, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);

      const { workspace } = addWorkspace({ name: 'personal', path });

      expect(workspace).toBeInstanceOf(Workspace);
      expect(workspace.verify()).toBe(true);
    });

    // The registration normalizes, and the entity is what the caller prints, so a
    // path built from the typed spelling would print one thing and store another.
    it('carries the path the registration normalized rather than the one typed', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);

      const { workspace } = addWorkspace({ name: 'personal', path: `${path}/../project/` });

      expect(workspace.path).toBe(path);
      expect(manager.getRegistry().workspaces.personal?.path).toBe(path);
    });

    it('carries a path that the registration had to create', async () => {
      const { addWorkspace, root } = await newUseCase();
      const path = join(root, 'project', 'skills');

      mkdirSync(join(root, 'project'));

      const { workspace } = addWorkspace({ name: 'personal', path });

      expect(workspace.path).toBe(path);
      expect(workspace.verify()).toBe(true);
    });
  });

  describe('the creation it reports', () => {
    it('reports the directory it had to create', async () => {
      const { addWorkspace, root } = await newUseCase();
      const path = join(root, 'project', 'skills');

      mkdirSync(join(root, 'project'));

      expect(addWorkspace({ name: 'personal', path }).created).toBe(true);
    });

    it('reports nothing created when the directory was already there', async () => {
      const { addWorkspace, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);

      expect(addWorkspace({ name: 'personal', path }).created).toBe(false);
    });
  });

  describe('autoLink', () => {
    it('records the workspace as auto-link when asked', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);

      expect(addWorkspace({ name: 'personal', path, autoLink: true }).workspace.autoLink).toBe(true);
      expect(manager.getRegistry().workspaces.personal).toEqual({ path, autoLink: true });
    });

    it('records the workspace as manual when asked', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);

      expect(addWorkspace({ name: 'personal', path, autoLink: false }).workspace.autoLink).toBe(false);
      expect(manager.getRegistry().workspaces.personal).toEqual({ path, autoLink: false });
    });

    // The default is settled here rather than left to the store manager, so the
    // entity and the registry cannot disagree about an omitted flag.
    it('records the workspace as manual when the flag is omitted', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);

      expect(addWorkspace({ name: 'personal', path }).workspace.autoLink).toBe(false);
      expect(manager.getRegistry().workspaces.personal).toEqual({ path, autoLink: false });
    });

    it('links nothing into the workspace, not even the skills the store already holds', async () => {
      const { addWorkspace, store, root } = await newUseCase();
      const path = join(root, 'project');

      mkdirSync(path);
      mkdirSync(join(store.paths.skills, 'brainstorm'), { recursive: true });

      addWorkspace({ name: 'personal', path, autoLink: true });

      expect(readdirSync(path)).toEqual([]);
    });
  });

  /**
   * Every refusal belongs to the registration, and the use case adds none of its
   * own: it must not soften one into a result, nor leave a directory behind.
   */
  describe('refusals', () => {
    it('refuses a name that is already registered, leaving its path alone', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const taken = join(root, 'taken');

      mkdirSync(taken);
      addWorkspace({ name: 'personal', path: taken });

      const path = join(root, 'project');

      expect(refusal(() => addWorkspace({ name: 'personal', path }))).toBeInstanceOf(DuplicateNameError);
      expect(manager.getRegistry().workspaces.personal?.path).toBe(taken);
      expect(existsSync(path)).toBe(false);
    });

    it('refuses a relative path, registering nothing', async () => {
      const { addWorkspace, manager } = await newUseCase();

      expect(refusal(() => addWorkspace({ name: 'personal', path: 'project/skills' }))).toBeInstanceOf(
        InvalidPathError,
      );
      expect(manager.getRegistry().workspaces).toEqual({});
    });

    it('refuses a path held by a file', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const path = join(root, 'notes.txt');

      writeFileSync(path, '');

      expect(refusal(() => addWorkspace({ name: 'personal', path }))).toBeInstanceOf(InvalidPathError);
      expect(manager.getRegistry().workspaces).toEqual({});
    });

    it('refuses a symlinked path rather than following it', async () => {
      const { addWorkspace, manager, root } = await newUseCase();
      const target = join(root, 'target');
      const path = join(root, 'project');

      mkdirSync(target);
      symlinkSync(target, path);

      expect(refusal(() => addWorkspace({ name: 'personal', path }))).toBeInstanceOf(InvalidPathError);
      expect(manager.getRegistry().workspaces).toEqual({});
    });

    it('refuses a missing parent, creating nothing', async () => {
      const { addWorkspace, root } = await newUseCase();
      const parent = join(root, 'project', 'claude');

      expect(
        refusal(() => addWorkspace({ name: 'personal', path: join(parent, 'skills') })),
      ).toBeInstanceOf(InvalidPathError);
      expect(existsSync(parent)).toBe(false);
    });

    it.each([
      ['equal to the store root', (store: GrimoireStore) => store.paths.root],
      ['inside the store', (store: GrimoireStore) => join(store.paths.skills, 'personal')],
      ['containing the store', (store: GrimoireStore) => dirname(store.paths.root)],
    ])('refuses a path %s, creating nothing', async (_, pathFor) => {
      const { addWorkspace, manager, store } = await newUseCase();
      const path = pathFor(store);

      expect(refusal(() => addWorkspace({ name: 'personal', path }))).toBeInstanceOf(PathCollisionError);
      expect(manager.getRegistry().workspaces).toEqual({});
      expect(existsSync(join(store.paths.skills, 'personal'))).toBe(false);
    });
  });
});

async function newUseCase(): Promise<{
  addWorkspace: ReturnType<typeof createAddWorkspaceUseCase>;
  manager: GrimoireStoreManager;
  store: GrimoireStore;
  root: string;
}> {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));
  const manager = new GrimoireStoreManager(store);

  return { addWorkspace: createAddWorkspaceUseCase({ storeManager: manager }), manager, store, root };
}

/** A GrimoireError is what keeps cli.ts from printing a stack trace. */
function refusal(run: () => unknown): GrimoireError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GrimoireError);

    return error as GrimoireError;
  }

  expect.fail('expected a refusal');
}
