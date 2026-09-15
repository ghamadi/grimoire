import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CollidingRegistrationError,
  DuplicateNameError,
  EntityNotFoundError,
  GrimoireError,
  InvalidShapeError,
  PathCollisionError,
} from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';
import { GrimoireStore, GrimoireStoreManager } from '../index.ts';

describe('registerWorkspace', () => {
  it('reports the directory it had to create', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project', 'skills');

    mkdirSync(join(root, 'project'));

    expect(manager.registerWorkspace({ name: 'personal', path })).toEqual({ path, created: true });
  });

  it('reports nothing created when the directory was already there', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    mkdirSync(path);

    expect(manager.registerWorkspace({ name: 'personal', path })).toEqual({ path, created: false });
  });

  it('registers the workspace under the name it was given', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    manager.registerWorkspace({ name: 'personal', path, autoLink: true });

    expect(manager.getRegistry().workspaces).toEqual({ personal: { path, autoLink: true } });
  });

  // The name is what refuses, so it refuses before anything reaches the disk.
  it('refuses a duplicate name without creating the directory', async () => {
    const { manager, root } = await newManager();
    const taken = join(root, 'taken');

    manager.registerWorkspace({ name: 'personal', path: taken });

    const path = join(root, 'other');

    expect(() => manager.registerWorkspace({ name: 'personal', path })).toThrow(DuplicateNameError);
    expect(existsSync(path)).toBe(false);
  });

  // Registering inside the store would put a deployment target where grimoire
  // writes, and `link` replaces a directory matching the store copy silently.
  it.each([
    ['equal to the store root', (store: GrimoireStore) => store.paths.root],
    ['inside the store', (store: GrimoireStore) => join(store.paths.skills, 'personal')],
    ['containing the store', (store: GrimoireStore) => dirname(store.paths.root)],
  ])('refuses a path %s, creating nothing', async (_, pathFor) => {
    const { manager, store } = await newManager();
    const path = pathFor(store);

    expect(() => manager.registerWorkspace({ name: 'personal', path })).toThrow(PathCollisionError);
    expect(manager.getRegistry().workspaces).toEqual({});
    expect(existsSync(join(store.paths.skills, 'personal'))).toBe(false);
  });

  // Every object answers to `toString`, so a lookup rather than `Object.hasOwn`
  // reads an empty registry as already holding the name.
  it('registers a name that an object inherits from its prototype', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    mkdirSync(path);

    expect(manager.registerWorkspace({ name: 'toString', path })).toEqual({ path, created: false });
    expect(manager.getRegistry().workspaces).toEqual({ toString: { path, autoLink: false } });
  });
});

describe('requireWorkspace', () => {
  it('returns the registered workspace', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    manager.registerWorkspace({ name: 'personal', path, autoLink: true });

    expect(manager.requireRegisteredWorkspace('personal')).toEqual({
      name: 'personal',
      path,
      autoLink: true,
    });
  });

  it('refuses an unregistered name', async () => {
    const { manager } = await newManager();

    expect(() => manager.requireRegisteredWorkspace('personal')).toThrow(EntityNotFoundError);
  });

  it('refuses a name an object inherits from its prototype', async () => {
    const { manager } = await newManager();

    expect(() => manager.requireRegisteredWorkspace('toString')).toThrow(EntityNotFoundError);
  });
});

/**
 * A hand-edited state.json is the routine case here, and every one of these
 * has to arrive as a refusal — cli.ts prints a stack trace for anything that is
 * not a GrimoireError.
 */
describe('reading state.json', () => {
  it('reads an absent file as a first run', async () => {
    const { manager } = await newManager();

    expect(manager.getRegistry()).toEqual({ workspaces: {}, skills: {}, ignore: ['.DS_Store'] });
  });

  it('refuses a file that is not valid JSON, naming it', async () => {
    const { manager, store } = await newManager();

    writeState(store, '{ "workspaces": ');

    expect(refusal(() => manager.getRegistry()).message).toContain(store.paths.state);
  });

  // The key `repos` was dropped from the schema, so every state written before
  // that arrives here.
  it('refuses an unrecognized key, naming it', async () => {
    const { manager, store } = await newManager();

    writeState(store, '{ "repos": {}, "workspaces": {} }');

    expect(refusal(() => manager.getRegistry()).message).toContain('repos');
  });

  it('refuses a wrong-typed field, naming the entry', async () => {
    const { manager, store } = await newManager();

    writeState(store, '{ "workspaces": { "personal": { "path": "/x", "autoLink": "yes" } } }');

    expect(refusal(() => manager.getRegistry()).message).toContain('personal');
  });

  // A file holding `null` parses fine and holds no state: absence is the
  // missing file, and nothing else.
  it('refuses a file holding null rather than reading it as a first run', async () => {
    const { manager, store } = await newManager();

    writeState(store, 'null');

    refusal(() => manager.getRegistry());
  });
});

/**
 * `registerWorkspace` refuses to create one of these, so an entry that exists
 * was hand-written. The rule is applied on the way in rather than by each
 * caller: every read below goes through the same door, and a rule enforced per
 * command is one each command gets to answer differently.
 */
describe('a registered path that touches the store', () => {
  it.each([
    ['sitting inside the store', (store: GrimoireStore) => join(store.paths.skills, 'personal')],
    ['equal to the store root', (store: GrimoireStore) => store.paths.root],
    ['containing the store', (store: GrimoireStore) => dirname(store.paths.root)],
  ])('refuses a path %s', async (_, pathFor) => {
    const { manager, store } = await newManager();

    writeState(store, document({ workspaces: { personal: { path: pathFor(store), autoLink: false } } }));

    expect(() => manager.getRegistry()).toThrow(CollidingRegistrationError);
  });

  it('names the entry and the file it has to leave', async () => {
    const { manager, store } = await newManager();
    const path = join(store.paths.skills, 'personal');

    writeState(store, document({ workspaces: { personal: { path, autoLink: false } } }));

    expect(() => manager.getRegistry()).toThrow(
      new RegExp(`workspace "personal".*\\n.*${store.paths.state}`),
    );
  });

  // A registry is read before anything else happens, so the rule reaches every
  // one of these without any of them asking.
  it.each([
    ['getRegistry', (manager: GrimoireStoreManager) => manager.getRegistry()],
    ['listRegisteredWorkspaces', (manager: GrimoireStoreManager) => manager.listRegisteredWorkspaces()],
    [
      'requireRegisteredWorkspace',
      (manager: GrimoireStoreManager) => manager.requireRegisteredWorkspace('work'),
    ],
    ['unregisterWorkspace', (manager: GrimoireStoreManager) => manager.unregisterWorkspace('work')],
    [
      'registerWorkspace',
      (manager: GrimoireStoreManager) => manager.registerWorkspace({ name: 'new', path: '/tmp/new' }),
    ],
  ])('refuses %s while the entry is registered', async (_, read) => {
    const { manager, store, root } = await newManager();
    const work = join(root, 'work');

    mkdirSync(work);
    writeState(
      store,
      document({
        workspaces: {
          personal: { path: join(store.paths.skills, 'personal'), autoLink: false },
          work: { path: work, autoLink: false },
        },
      }),
    );

    expect(() => read(manager)).toThrow(CollidingRegistrationError);
  });

  // Two of them means the message would otherwise name whichever the object
  // happened to yield first, which is not stable across runs.
  it('names the first entry by name when several collide', async () => {
    const { manager, store } = await newManager();

    writeState(
      store,
      document({
        workspaces: {
          zulu: { path: join(store.paths.skills, 'zulu'), autoLink: false },
          alpha: { path: join(store.paths.skills, 'alpha'), autoLink: false },
        },
      }),
    );

    expect(() => manager.getRegistry()).toThrow(/workspace "alpha"/);
  });
});

describe('unregisterWorkspace', () => {
  it('answers with the workspace it dropped', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    manager.registerWorkspace({ name: 'personal', path, autoLink: true });

    expect(manager.unregisterWorkspace('personal')).toEqual({
      name: 'personal',
      path,
      autoLink: true,
    });
  });

  it('drops it from the registry', async () => {
    const { manager, root } = await newManager();

    manager.registerWorkspace({ name: 'personal', path: join(root, 'project') });
    manager.unregisterWorkspace('personal');

    expect(manager.getRegistry().workspaces).toEqual({});
  });

  it('leaves every other registration alone', async () => {
    const { manager, root } = await newManager();
    const kept = join(root, 'work');

    manager.registerWorkspace({ name: 'personal', path: join(root, 'project') });
    manager.registerWorkspace({ name: 'work', path: kept, autoLink: true });
    manager.unregisterWorkspace('personal');

    expect(manager.getRegistry().workspaces).toEqual({ work: { path: kept, autoLink: true } });
  });

  // The whole file is rewritten on every save, so a key this method never reads
  // is a key it can silently drop.
  it('leaves the rest of the state alone', async () => {
    const { manager, store, root } = await newManager();
    const path = join(root, 'project');

    writeState(store, JSON.stringify({ workspaces: {}, ignore: ['.git'] }));
    manager.registerWorkspace({ name: 'personal', path });
    manager.unregisterWorkspace('personal');

    expect(manager.getRegistry().ignore).toEqual(['.git']);
  });

  // Unregistering is the documented fix for a workspace registered somewhere
  // wrong, and a fix that deletes the directory is not one anybody would run.
  it('leaves the directory and its contents on disk', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    manager.registerWorkspace({ name: 'personal', path });
    writeFileSync(join(path, 'notes.md'), 'kept', 'utf8');
    manager.unregisterWorkspace('personal');

    expect(existsSync(join(path, 'notes.md'))).toBe(true);
  });

  it('frees the name to be registered again', async () => {
    const { manager, root } = await newManager();
    const second = join(root, 'other');

    manager.registerWorkspace({ name: 'personal', path: join(root, 'project') });
    manager.unregisterWorkspace('personal');

    expect(() => manager.registerWorkspace({ name: 'personal', path: second })).not.toThrow();
    expect(manager.getRegistry().workspaces).toEqual({
      personal: { path: second, autoLink: false },
    });
  });

  it('refuses an unregistered name', async () => {
    const { manager } = await newManager();

    expect(() => manager.unregisterWorkspace('personal')).toThrow(EntityNotFoundError);
  });

  it('refuses a name an object inherits from its prototype', async () => {
    const { manager } = await newManager();

    expect(() => manager.unregisterWorkspace('toString')).toThrow(EntityNotFoundError);
  });

  it('refuses without touching the registry', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    manager.registerWorkspace({ name: 'personal', path });

    expect(() => manager.unregisterWorkspace('work')).toThrow(EntityNotFoundError);
    expect(manager.getRegistry().workspaces).toEqual({ personal: { path, autoLink: false } });
  });
});

describe('clone records', () => {
  const clonedIntoPersonal = { deploy: { clones: [{ workspace: 'personal' }] } };

  it('rewrites the records of a workspace to carry its path', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: clonedIntoPersonal }));
    manager.recordClonesByPath({ workspace: 'personal', path: '/projects/app' });

    expect(manager.getRegistry().skills).toEqual({ deploy: { clones: [{ path: '/projects/app' }] } });
  });

  it('answers with every skill it rewrote, sorted', async () => {
    const { manager, store } = await newManager();

    writeState(
      store,
      document({
        skills: {
          shipper: { clones: [{ workspace: 'personal' }] },
          deploy: { clones: [{ workspace: 'personal' }] },
        },
      }),
    );

    expect(manager.recordClonesByPath({ workspace: 'personal', path: '/projects/app' })).toEqual([
      'deploy',
      'shipper',
    ]);
  });

  it('leaves the records of another workspace alone', async () => {
    const { manager, store } = await newManager();

    writeState(
      store,
      document({ skills: { deploy: { clones: [{ workspace: 'work' }, { workspace: 'personal' }] } } }),
    );
    manager.recordClonesByPath({ workspace: 'personal', path: '/projects/app' });

    expect(manager.getRegistry().skills.deploy?.clones).toEqual([
      { workspace: 'work' },
      { path: '/projects/app' },
    ]);
  });

  it('leaves a record already kept by path alone', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: { deploy: { clones: [{ path: '/elsewhere' }] } } }));
    manager.recordClonesByPath({ workspace: 'personal', path: '/projects/app' });

    expect(manager.getRegistry().skills.deploy?.clones).toEqual([{ path: '/elsewhere' }]);
  });

  it('drops the records of a workspace under forget, answering with the skills', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: clonedIntoPersonal }));

    expect(manager.forgetSkillsClonedIntoWorkspace('personal')).toEqual(['deploy']);
  });

  // `clones: []` means "never cloned", which is what a forgotten record leaves.
  it('keeps the entry of a skill once its last record is forgotten', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: clonedIntoPersonal }));
    manager.forgetSkillsClonedIntoWorkspace('personal');

    expect(manager.getRegistry().skills).toEqual({ deploy: { clones: [] } });
  });

  it.each([
    [
      'recordClonesByPath',
      (manager: GrimoireStoreManager) =>
        manager.recordClonesByPath({ workspace: 'work', path: '/projects/app' }),
    ],
    [
      'forgetClonesInto',
      (manager: GrimoireStoreManager) => manager.forgetSkillsClonedIntoWorkspace('work'),
    ],
  ])('writes nothing when no record names the workspace: %s', async (_method, run) => {
    const { manager, store } = await newManager();
    const contents = document({ skills: clonedIntoPersonal });

    writeState(store, contents);

    expect(run(manager)).toEqual([]);
    expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
  });
});

describe('findLinksInWorkspace', () => {
  it('answers with the links the workspace holds into the store, sorted by skill', async () => {
    const { manager, store, root } = await newManager();
    const workspace = join(root, 'project');

    mkdirSync(workspace, { recursive: true });
    manager.registerWorkspace({ name: 'personal', path: workspace });
    linkSkill({ store, workspace, skill: 'triage' });
    linkSkill({ store, workspace, skill: 'brainstorm' });

    expect(manager.findLinksFromWorkspace('personal')).toEqual([
      { skill: 'brainstorm', path: join(workspace, 'brainstorm') },
      { skill: 'triage', path: join(workspace, 'triage') },
    ]);
  });

  it('leaves out a symlink aimed somewhere other than the store', async () => {
    const { manager, root } = await newManager();
    const workspace = join(root, 'project');
    const elsewhere = join(root, 'elsewhere');

    mkdirSync(workspace, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    manager.registerWorkspace({ name: 'personal', path: workspace });
    symlinkSync(elsewhere, join(workspace, 'stray'));

    expect(manager.findLinksFromWorkspace('personal')).toEqual([]);
  });

  it('refuses a name registered nowhere', async () => {
    const { manager } = await newManager();

    expect(() => manager.findLinksFromWorkspace('ghost')).toThrow(EntityNotFoundError);
  });
});

async function newManager(): Promise<{
  manager: GrimoireStoreManager;
  store: GrimoireStore;
  root: string;
}> {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));

  return { manager: new GrimoireStoreManager(store), store, root };
}

/** Puts raw text on disk as state.json, bypassing every validation. */
function writeState(store: GrimoireStore, contents: string): void {
  mkdirSync(store.paths.root, { recursive: true });
  writeFileSync(store.paths.state, contents, 'utf8');
}

/** Puts a skill in the store and symlinks it into the workspace, the way `link` does. */
function linkSkill(params: { store: GrimoireStore; workspace: string; skill: string }): void {
  const { store, workspace, skill } = params;
  const target = join(store.paths.skills, skill);

  mkdirSync(target, { recursive: true });
  symlinkSync(target, join(workspace, skill));
}

/** A whole state.json, as text, carrying only the sections a test cares about. */
function document(sections: { workspaces?: unknown; skills?: unknown; ignore?: unknown }): string {
  return JSON.stringify({ workspaces: {}, skills: {}, ignore: ['.DS_Store'], ...sections });
}

/** A GrimoireError is what keeps cli.ts from printing a stack trace. */
function refusal(run: () => unknown): InvalidShapeError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidShapeError);
    expect(error).toBeInstanceOf(GrimoireError);

    return error as InvalidShapeError;
  }

  expect.fail('expected a refusal');
}
