import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store';
import { Workspace } from '@/domains/workspace';
import {
  CollidingRegistrationError,
  EntityNotFoundError,
  GrimoireError,
  UnreadableWorkspaceRemovalError,
  WorkspaceInUseError,
} from '@/lib/errors';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';
import { createRemoveWorkspaceUseCase } from '@/use-cases/remove-workspace-use-case/factory';

describe('remove-workspace-use-case factory', () => {
  describe('the use-case it returns', () => {
    it('drops the registration', async () => {
      const { removeWorkspace, register, manager } = await newUseCase();

      register('personal');
      removeWorkspace({ name: 'personal' });

      expect(manager.getRegistry().workspaces).toEqual({});
    });

    it('keeps the workspaces it was not asked about', async () => {
      const { removeWorkspace, register, manager } = await newUseCase();
      const work = register('work');

      register('personal');
      removeWorkspace({ name: 'personal' });

      expect(manager.getRegistry().workspaces).toEqual({ work: { path: work, autoLink: false } });
    });

    // The directory is the user's; the registration is grimoire's. Deleting one
    // while surrendering the other would make `remove` unusable as the fix for a
    // path registered by mistake.
    it('leaves the directory and everything in it alone', async () => {
      const { removeWorkspace, register } = await newUseCase();
      const path = register('personal');

      mkdirSync(join(path, 'notes'));
      removeWorkspace({ name: 'personal' });

      expect(existsSync(path)).toBe(true);
      expect(existsSync(join(path, 'notes'))).toBe(true);
    });

    // A registry read at construction would answer with the state the CLI
    // started in, which is the state before the command that just ran.
    it('reads the registry on each call rather than at construction', async () => {
      const { removeWorkspace, register, manager } = await newUseCase();

      register('personal');
      removeWorkspace({ name: 'personal' });
      register('personal');

      expect(manager.getRegistry().workspaces.personal).toBeDefined();
      expect(() => removeWorkspace({ name: 'personal' })).not.toThrow();
    });

    // A store manager captured at call time rather than at construction would let
    // two use cases built from different stores write to whichever ran last.
    it('unregisters against the store manager it was built with', async () => {
      const first = await newUseCase();
      const second = await newUseCase();

      first.register('personal');
      second.register('personal');
      first.removeWorkspace({ name: 'personal' });

      expect(second.manager.getRegistry().workspaces.personal).toBeDefined();
    });

    // Every object answers to `toString`, so a registry read through a plain
    // lookup reports a registration for a name nothing was ever filed under.
    it('unregisters a name that an object inherits from its prototype', async () => {
      const { removeWorkspace, register, manager } = await newUseCase();

      register('toString');

      expect(removeWorkspace({ name: 'toString' }).workspace.name).toBe('toString');
      expect(manager.getRegistry().workspaces).toEqual({});
    });
  });

  describe('the workspace it returns', () => {
    it('carries the name, path, and auto-link flag it was registered with', async () => {
      const { removeWorkspace, register } = await newUseCase();
      const path = register('personal', { autoLink: true });

      expect(removeWorkspace({ name: 'personal' }).workspace).toEqual(
        new Workspace({ name: 'personal', path, autoLink: true }),
      );
    });

    it('is a Workspace entity rather than a plain record', async () => {
      const { removeWorkspace, register } = await newUseCase();

      register('personal');

      expect(removeWorkspace({ name: 'personal' }).workspace).toBeInstanceOf(Workspace);
    });

    // The caller prints this path, and a registration whose directory is gone is
    // exactly the one being cleaned up, so it comes back unverified.
    it('carries a path that no longer resolves', async () => {
      const { removeWorkspace, writeRegistry } = await newUseCase();
      const path = join(await tempRoot(), 'gone');

      writeRegistry({ personal: { path, autoLink: false } });

      const { workspace } = removeWorkspace({ name: 'personal' });

      expect(workspace.path).toBe(path);
      expect(workspace.getDirectoryAccess()).toBe('unresolvable');
    });
  });

  describe('links into the store', () => {
    it('refuses while links still point at the workspace, naming them sorted', async () => {
      const { removeWorkspace, register, link } = await newUseCase();

      register('personal');
      link({ workspace: 'personal', skill: 'triage' });
      link({ workspace: 'personal', skill: 'brainstorm' });

      const error = refusal(() => removeWorkspace({ name: 'personal' }));

      expect(error).toBeInstanceOf(WorkspaceInUseError);
      expect((error as WorkspaceInUseError).links).toEqual(['brainstorm', 'triage']);
    });

    it('leaves the registration and the links alone when it refuses', async () => {
      const { removeWorkspace, register, link, manager } = await newUseCase();

      register('personal');

      const path = link({ workspace: 'personal', skill: 'brainstorm' });

      refusal(() => removeWorkspace({ name: 'personal' }));

      expect(manager.getRegistry().workspaces.personal).toBeDefined();
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    });

    it('leaves the clone records alone when it refuses', async () => {
      const { removeWorkspace, register, link, recordClones, readClones } = await newUseCase();

      register('personal');
      link({ workspace: 'personal', skill: 'brainstorm' });
      recordClones({ deploy: [{ workspace: 'personal' }] });

      refusal(() => removeWorkspace({ name: 'personal' }));

      expect(readClones().deploy).toEqual([{ workspace: 'personal' }]);
    });

    it('clears the links under --hard, and reports the skills it cleared', async () => {
      const { removeWorkspace, register, link } = await newUseCase();

      register('personal');

      const triage = link({ workspace: 'personal', skill: 'triage' });
      const brainstorm = link({ workspace: 'personal', skill: 'brainstorm' });

      expect(removeWorkspace({ name: 'personal', hard: true }).clearedLinks).toEqual([
        'brainstorm',
        'triage',
      ]);
      expect(existsSync(triage)).toBe(false);
      expect(existsSync(brainstorm)).toBe(false);
    });

    // The link is the deployment; the skill is the store's copy of it.
    it('leaves the store skill in place under --hard', async () => {
      const { removeWorkspace, register, link, store } = await newUseCase();

      register('personal');
      link({ workspace: 'personal', skill: 'brainstorm' });
      removeWorkspace({ name: 'personal', hard: true });

      expect(existsSync(join(store.paths.skills, 'brainstorm'))).toBe(true);
    });

    it('reports nothing cleared when the workspace holds no links', async () => {
      const { removeWorkspace, register } = await newUseCase();

      register('personal');

      expect(removeWorkspace({ name: 'personal', hard: true }).clearedLinks).toEqual([]);
    });

    // Only links into the store are grimoire's to clear, so one pointing anywhere
    // else neither refuses the removal nor gets unlinked by it.
    it('neither refuses over nor clears a symlink pointing outside the store', async () => {
      const { removeWorkspace, register, root } = await newUseCase();
      const path = register('personal');
      const elsewhere = join(root, 'vendored');

      mkdirSync(elsewhere);
      symlinkSync(elsewhere, join(path, 'vendored'));

      expect(removeWorkspace({ name: 'personal' }).clearedLinks).toEqual([]);
      expect(lstatSync(join(path, 'vendored')).isSymbolicLink()).toBe(true);
    });
  });

  /**
   * The record is the only thing marking a cloned directory as a managed copy,
   * and the name it carries stops resolving here.
   */
  describe('clone records', () => {
    it('rewrites the workspace records to carry its path, and reports the skills', async () => {
      const { removeWorkspace, register, recordClones, readClones } = await newUseCase();
      const path = register('personal');

      recordClones({ deploy: [{ workspace: 'personal' }], triage: [{ workspace: 'personal' }] });

      expect(removeWorkspace({ name: 'personal' }).convertedClones).toEqual(['deploy', 'triage']);
      expect(readClones()).toEqual({ deploy: [{ path }], triage: [{ path }] });
    });

    it('rewrites nothing under --hard, dropping the records instead', async () => {
      const { removeWorkspace, register, recordClones, readClones } = await newUseCase();

      register('personal');
      recordClones({ deploy: [{ workspace: 'personal' }] });

      const result = removeWorkspace({ name: 'personal', hard: true });

      expect(result.forgottenClones).toEqual(['deploy']);
      expect(result.convertedClones).toEqual([]);
      expect(readClones()).toEqual({ deploy: [] });
    });

    // `clones: []` means "never cloned", which is what a forgotten record leaves.
    it('keeps the skill under --hard, with no records left on it', async () => {
      const { removeWorkspace, register, recordClones, readClones } = await newUseCase();

      register('personal');
      recordClones({ deploy: [{ workspace: 'personal' }] });
      removeWorkspace({ name: 'personal', hard: true });

      expect(Object.keys(readClones())).toEqual(['deploy']);
    });

    it('never deletes the cloned directory, with or without --hard', async () => {
      const { removeWorkspace, register, recordClones } = await newUseCase();
      const path = register('personal');

      mkdirSync(join(path, 'deploy'));
      recordClones({ deploy: [{ workspace: 'personal' }] });
      removeWorkspace({ name: 'personal', hard: true });

      expect(existsSync(join(path, 'deploy'))).toBe(true);
    });

    // A `{ path }` record keeps resolving after the name is gone, so nothing about
    // it is at stake here.
    it('leaves a record already carrying a path alone', async () => {
      const { removeWorkspace, register, recordClones, readClones } = await newUseCase();

      register('personal');
      recordClones({ deploy: [{ path: '/elsewhere/deploy' }] });

      expect(removeWorkspace({ name: 'personal' }).convertedClones).toEqual([]);
      expect(readClones().deploy).toEqual([{ path: '/elsewhere/deploy' }]);
    });

    it('leaves the records naming a different workspace alone', async () => {
      const { removeWorkspace, register, recordClones, readClones } = await newUseCase();

      register('personal');
      register('work');
      recordClones({ deploy: [{ workspace: 'work' }] });

      expect(removeWorkspace({ name: 'personal' }).convertedClones).toEqual([]);
      expect(readClones().deploy).toEqual([{ workspace: 'work' }]);
    });

    it('reports nothing when no record names the workspace', async () => {
      const { removeWorkspace, register } = await newUseCase();

      register('personal');

      const result = removeWorkspace({ name: 'personal' });

      expect(result.convertedClones).toEqual([]);
      expect(result.forgottenClones).toEqual([]);
    });
  });

  describe('a workspace whose directory cannot be read', () => {
    describe.skipIf(runsAsRoot)('without --force', () => {
      it('refuses, naming the workspace and path, and leaves state.json byte-identical', async () => {
        const { removeWorkspace, register, recordClones, store } = await newUseCase();
        const path = register('personal');

        recordClones({ deploy: [{ workspace: 'personal' }] });

        const before = readFileSync(store.paths.state, 'utf8');

        lockDirectory({ path });

        const error = refusal(() => removeWorkspace({ name: 'personal' }));

        expect(error).toBeInstanceOf(UnreadableWorkspaceRemovalError);
        expect(error).toMatchObject({ entryName: 'personal', path, hard: false });
        expect(readFileSync(store.paths.state, 'utf8')).toBe(before);
      });

      it('refuses under --hard too, carrying hard, and leaves state.json byte-identical', async () => {
        const { removeWorkspace, register, recordClones, store } = await newUseCase();
        const path = register('personal');

        recordClones({ deploy: [{ workspace: 'personal' }] });

        const before = readFileSync(store.paths.state, 'utf8');

        lockDirectory({ path });

        const error = refusal(() => removeWorkspace({ name: 'personal', hard: true }));

        expect(error).toBeInstanceOf(UnreadableWorkspaceRemovalError);
        expect(error).toMatchObject({ hard: true });
        expect(readFileSync(store.paths.state, 'utf8')).toBe(before);
      });
    });

    describe.skipIf(runsAsRoot)('with --force', () => {
      it('unregisters, reports the links as unchecked, and converts the clone records to paths', async () => {
        const { removeWorkspace, register, recordClones, readClones, manager } = await newUseCase();
        const path = register('personal');

        recordClones({ deploy: [{ workspace: 'personal' }] });
        lockDirectory({ path });

        const result = removeWorkspace({ name: 'personal', force: true });

        expect(result.linksUnchecked).toBe(true);
        expect(result.clearedLinks).toEqual([]);
        expect(result.convertedClones).toEqual(['deploy']);
        expect(manager.getRegistry().workspaces).toEqual({});
        expect(readClones()).toEqual({ deploy: [{ path }] });
      });

      it('forgets the clone records under --hard', async () => {
        const { removeWorkspace, register, recordClones, readClones } = await newUseCase();
        const path = register('personal');

        recordClones({ deploy: [{ workspace: 'personal' }] });
        lockDirectory({ path });

        const result = removeWorkspace({ name: 'personal', hard: true, force: true });

        expect(result.linksUnchecked).toBe(true);
        expect(result.forgottenClones).toEqual(['deploy']);
        expect(readClones()).toEqual({ deploy: [] });
      });
    });

    describe('--force on a workspace that can be read', () => {
      it('still refuses while links point at it', async () => {
        const { removeWorkspace, register, link, manager } = await newUseCase();

        register('personal');
        link({ workspace: 'personal', skill: 'triage' });

        expect(refusal(() => removeWorkspace({ name: 'personal', force: true }))).toBeInstanceOf(
          WorkspaceInUseError,
        );
        expect(manager.getRegistry().workspaces.personal).toBeDefined();
      });

      it('unregisters one holding no links, with nothing unchecked', async () => {
        const { removeWorkspace, register } = await newUseCase();

        register('personal');

        expect(removeWorkspace({ name: 'personal', force: true }).linksUnchecked).toBe(false);
      });
    });

    // The link scan runs only for a directory that can be read, and a cycle is not one.
    it('unregisters a path that is a symlink cycle, with nothing unchecked', async () => {
      const { removeWorkspace, writeRegistry, manager, root } = await newUseCase();
      const cycle = join(root, 'a');

      symlinkSync(join(root, 'b'), cycle);
      symlinkSync(cycle, join(root, 'b'));
      writeRegistry({ personal: { path: cycle, autoLink: false } });

      const result = removeWorkspace({ name: 'personal' });

      expect(result.linksUnchecked).toBe(false);
      expect(manager.getRegistry().workspaces).toEqual({});
    });
  });

  /**
   * `registerWorkspace` refuses to create one of these, and the store manager
   * refuses to read a registry holding one — so this use case never sees one, and
   * neither does any other. Repairing `state.json` is not `remove`'s job.
   */
  describe('a registered path that touches the store', () => {
    it('refuses, leaving the registration in place', async () => {
      const { removeWorkspace, writeRegistry, colliding, readRegistry } = await newUseCase();

      writeRegistry({ personal: { path: colliding(), autoLink: false } });

      expect(refusal(() => removeWorkspace({ name: 'personal' }))).toBeInstanceOf(
        CollidingRegistrationError,
      );
      expect(readRegistry().personal).toBeDefined();
    });

    // The registry is refused whole, so one bad entry costs every other one too.
    // Nothing here reopens it: a command that unregistered the healthy workspace
    // would leave the file just as unloadable as it found it.
    it('refuses a healthy workspace while a colliding one is registered', async () => {
      const { removeWorkspace, register, writeRegistry, colliding, readRegistry } = await newUseCase();
      const work = register('work');

      writeRegistry({
        work: { path: work, autoLink: false },
        personal: { path: colliding(), autoLink: false },
      });

      expect(refusal(() => removeWorkspace({ name: 'work' }))).toBeInstanceOf(
        CollidingRegistrationError,
      );
      expect(readRegistry().work).toBeDefined();
    });
  });

  describe('refusals', () => {
    it('refuses a name that is not registered', async () => {
      const { removeWorkspace } = await newUseCase();

      expect(refusal(() => removeWorkspace({ name: 'personal' }))).toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses a name that is not registered even under --hard', async () => {
      const { removeWorkspace, register } = await newUseCase();

      register('work');

      expect(refusal(() => removeWorkspace({ name: 'personal', hard: true }))).toBeInstanceOf(
        EntityNotFoundError,
      );
    });

    it('leaves the clone records of a name it refused alone', async () => {
      const { removeWorkspace, register, recordClones, readClones } = await newUseCase();

      register('work');
      recordClones({ deploy: [{ workspace: 'work' }] });
      refusal(() => removeWorkspace({ name: 'personal', hard: true }));

      expect(readClones().deploy).toEqual([{ workspace: 'work' }]);
    });
  });
});

type CloneRecord = { workspace: string } | { path: string };
type RegisteredEntry = { path: string; autoLink: boolean };

/** state.json as it sits on disk, carrying only the sections these tests touch. */
type StoredDocument = {
  workspaces?: Record<string, RegisteredEntry>;
  skills?: Record<string, { clones: CloneRecord[] }>;
};

async function newUseCase() {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));
  const manager = new GrimoireStoreManager(store);

  /** Registers a workspace over a directory of the same name, and returns its path. */
  function register(name: string, options: { autoLink?: boolean } = {}): string {
    const path = join(root, name);

    mkdirSync(path, { recursive: true });
    manager.registerWorkspace({ name, path, autoLink: options.autoLink });

    return path;
  }

  /** A path inside the store, which `add` refuses and only a hand-edit can register. */
  function colliding(name = 'personal'): string {
    const path = join(store.paths.skills, name);

    mkdirSync(path, { recursive: true });

    return path;
  }

  /** The registry read straight off disk, bypassing the rule that refuses to load one. */
  function readRegistry(): Record<string, RegisteredEntry> {
    return readDocument().workspaces ?? {};
  }

  /** The registry as state.json holds it, bypassing everything that vets one. */
  function writeRegistry(workspaces: Record<string, RegisteredEntry>): void {
    mkdirSync(store.paths.root, { recursive: true });
    writeFileSync(store.paths.state, JSON.stringify({ workspaces }), 'utf8');
  }

  /** Puts a skill in the store and symlinks it into the workspace, the way `link` does. */
  function link(params: { workspace: string; skill: string }): string {
    const target = join(store.paths.skills, params.skill);
    const path = join(root, params.workspace, params.skill);

    mkdirSync(target, { recursive: true });
    symlinkSync(target, path);

    return path;
  }

  /** Clone records as state.json holds them, keyed by skill — no command writes one yet. */
  function recordClones(clonesBySkill: Record<string, CloneRecord[]>): void {
    mkdirSync(store.paths.root, { recursive: true });

    const skills = Object.fromEntries(
      Object.entries(clonesBySkill).map(([skill, clones]) => [skill, { clones }]),
    );

    writeFileSync(store.paths.state, JSON.stringify({ ...readDocument(), skills }), 'utf8');
  }

  /** The same records read back off disk, keyed by skill. */
  function readClones(): Record<string, CloneRecord[]> {
    const { skills = {} } = readDocument();

    return Object.fromEntries(Object.entries(skills).map(([skill, { clones }]) => [skill, clones]));
  }

  function readDocument(): StoredDocument {
    return existsSync(store.paths.state)
      ? (JSON.parse(readFileSync(store.paths.state, 'utf8')) as StoredDocument)
      : {};
  }

  return {
    removeWorkspace: createRemoveWorkspaceUseCase({ storeManager: manager }),
    register,
    colliding,
    readRegistry,
    writeRegistry,
    link,
    recordClones,
    readClones,
    manager,
    store,
    root,
  };
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
