import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
      { skill: 'brainstorm', storeSkill: 'brainstorm', path: join(workspace, 'brainstorm') },
      { skill: 'triage', storeSkill: 'triage', path: join(workspace, 'triage') },
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

describe('listSkillClones', () => {
  it('resolves a workspace record through the registry', async () => {
    const { manager, store, root } = await newManager();
    const workspace = join(root, 'personal');
    const record = { workspace: 'personal' };

    writeState(
      store,
      document({
        workspaces: { personal: { path: workspace, autoLink: false } },
        skills: { triage: { clones: [record] } },
      }),
    );

    expect(manager.listSkillClones('triage')).toEqual([
      { origin: 'personal', path: join(workspace, 'triage'), record },
    ]);
  });

  it('resolves a path record to the directory it names', async () => {
    const { manager, store } = await newManager();
    const record = { path: '/projects/app' };

    writeState(store, document({ skills: { triage: { clones: [record] } } }));

    expect(manager.listSkillClones('triage')).toEqual([
      { origin: '/projects/app', path: '/projects/app/triage', record },
    ]);
  });

  it('omits a record naming a workspace that is not registered', async () => {
    const { manager, store } = await newManager();
    const record = { path: '/projects/app' };

    writeState(store, document({ skills: { triage: { clones: [{ workspace: 'ghost' }, record] } } }));

    expect(manager.listSkillClones('triage')).toEqual([
      { origin: '/projects/app', path: '/projects/app/triage', record },
    ]);
  });

  it('answers nothing for a skill with no entry', async () => {
    const { manager } = await newManager();

    expect(manager.listSkillClones('triage')).toEqual([]);
  });

  // Every object answers to `toString`, so a lookup rather than `Object.hasOwn`
  // reads an empty document as holding the skill.
  it('answers nothing for a skill named after an inherited property', async () => {
    const { manager } = await newManager();

    expect(manager.listSkillClones('toString')).toEqual([]);
  });

  it('keeps the order the records were written in', async () => {
    const { manager, store } = await newManager();

    writeState(
      store,
      document({ skills: { triage: { clones: [{ path: '/b' }, { path: '/a' }] } } }),
    );

    expect(manager.listSkillClones('triage').map(({ origin }) => origin)).toEqual(['/b', '/a']);
  });
});

describe('trashSkill', () => {
  const at = new Date(2026, 8, 15, 12, 45, 30);
  const stamp = 'triage-20260915T124530';

  it('moves the store copy into <bin>/store and returns the bin', async () => {
    const { manager, store } = await newManager();

    writeSkillDirectory(join(store.paths.skills, 'triage'), { 'SKILL.md': '# triage\n' });

    const bin = manager.trashSkill({ name: 'triage', clones: [], at });

    expect(bin).toBe(join(store.paths.trash, stamp));
    expect(readFileSync(join(bin, 'store', 'SKILL.md'), 'utf8')).toBe('# triage\n');
    expect(existsSync(join(store.paths.skills, 'triage'))).toBe(false);
  });

  it('creates no clones directory when no clone was given', async () => {
    const { manager, store } = await newManager();

    writeSkillDirectory(join(store.paths.skills, 'triage'));

    const bin = manager.trashSkill({ name: 'triage', clones: [], at });

    expect(existsSync(join(bin, 'clones'))).toBe(false);
  });

  it('moves a clone to <bin>/clones/<label>', async () => {
    const { manager, store, root } = await newManager();
    const clone = writeSkillDirectory(join(root, 'app', 'triage'), { 'SKILL.md': '# clone\n' });

    writeSkillDirectory(join(store.paths.skills, 'triage'));

    const bin = manager.trashSkill({ name: 'triage', clones: [{ path: clone, label: 'app' }], at });

    expect(readFileSync(join(bin, 'clones', 'app', 'SKILL.md'), 'utf8')).toBe('# clone\n');
    expect(existsSync(clone)).toBe(false);
  });

  it('takes the next free suffix when the bin already exists', async () => {
    const { manager, store } = await newManager();

    writeSkillDirectory(join(store.paths.skills, 'triage'));
    const first = manager.trashSkill({ name: 'triage', clones: [], at });

    writeSkillDirectory(join(store.paths.skills, 'triage'));
    const second = manager.trashSkill({ name: 'triage', clones: [], at });

    expect(second).toBe(`${first}-2`);
  });

  it('skips a clone whose directory is gone and still moves the store copy', async () => {
    const { manager, store, root } = await newManager();

    writeSkillDirectory(join(store.paths.skills, 'triage'));

    const bin = manager.trashSkill({
      name: 'triage',
      clones: [{ path: join(root, 'gone', 'triage'), label: 'gone' }],
      at,
    });

    expect(existsSync(join(bin, 'store'))).toBe(true);
    expect(existsSync(join(bin, 'clones'))).toBe(false);
  });

  it('refuses a skill the store does not hold, leaving no bin behind', async () => {
    const { manager, store } = await newManager();

    expect(() => manager.trashSkill({ name: 'triage', clones: [], at })).toThrow(EntityNotFoundError);
    expect(readdirSync(store.paths.trash)).toEqual([]);
  });
});

describe('forgetSkill', () => {
  it('drops the skill entry whole', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: { triage: { clones: [{ path: '/a' }] } } }));
    manager.forgetSkill('triage');

    expect(manager.getRegistry().skills).toEqual({});
  });

  // Unlike forgetting a workspace's clones, which leaves `clones: []` behind.
  it('leaves no key behind, unlike forgetting the clones into a workspace', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: { triage: { clones: [{ workspace: 'personal' }] } } }));
    manager.forgetSkillsClonedIntoWorkspace('personal');

    expect(manager.getRegistry().skills).toEqual({ triage: { clones: [] } });

    manager.forgetSkill('triage');

    expect(manager.getRegistry().skills).toEqual({});
  });

  it('leaves other skills and the workspaces alone', async () => {
    const { manager, store } = await newManager();
    const workspaces = { personal: { path: '/ws', autoLink: false } };

    writeState(
      store,
      document({
        workspaces,
        skills: { triage: { clones: [] }, deploy: { clones: [{ path: '/a' }] } },
      }),
    );
    manager.forgetSkill('triage');

    expect(manager.getRegistry().skills).toEqual({ deploy: { clones: [{ path: '/a' }] } });
    expect(manager.getRegistry().workspaces).toEqual(workspaces);
  });

  it('writes nothing when the skill has no entry', async () => {
    const { manager, store } = await newManager();
    const contents = document({ skills: { deploy: { clones: [] } } });

    writeState(store, contents);
    manager.forgetSkill('triage');
    manager.forgetSkill('toString');

    expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
  });
});

describe('skillPath', () => {
  it('joins the name onto the skills root, creating nothing', async () => {
    const { manager, store } = await newManager();

    expect(manager.skillPath('brainstorm')).toBe(join(store.paths.skills, 'brainstorm'));
    expect(existsSync(store.paths.skills)).toBe(false);
  });
});

describe('assertOutsideStore', () => {
  it.each([
    ['equal to the store root', (store: GrimoireStore) => store.paths.root],
    ['inside the store', (store: GrimoireStore) => join(store.paths.skills, 'triage')],
    ['containing the store', (store: GrimoireStore) => dirname(store.paths.root)],
  ])('refuses a path %s', async (_, pathFor) => {
    const { manager, store } = await newManager();

    expect(() => manager.assertOutsideStore(pathFor(store))).toThrow(PathCollisionError);
  });

  it('accepts a path unrelated to the store', async () => {
    const { manager, root } = await newManager();

    expect(() => manager.assertOutsideStore(join(root, 'dev', 'triage'))).not.toThrow();
  });
});

describe('addSkill', () => {
  it('copies a tree verbatim and reports where it landed', async () => {
    const { manager, store, root } = await newManager();
    const source = join(root, 'dev', 'brainstorm');

    writeSkillDirectory(source, {
      '.gitignore': 'ignored',
      'reference/notes.md': 'notes',
      'scripts/run.sh': '#!/bin/sh\n',
    });
    chmodSync(join(source, 'scripts', 'run.sh'), 0o755);
    symlinkSync(join(source, 'SKILL.md'), join(source, 'alias.md'));

    const destination = manager.addSkill({ name: 'brainstorm', sourcePath: source });

    expect(destination).toBe(join(store.paths.skills, 'brainstorm'));
    expect(readFileSync(join(destination, 'SKILL.md'), 'utf8')).toBe('# skill\n');
    expect(readFileSync(join(destination, '.gitignore'), 'utf8')).toBe('ignored');
    expect(readFileSync(join(destination, 'reference', 'notes.md'), 'utf8')).toBe('notes');
    expect(lstatSync(join(destination, 'scripts', 'run.sh')).mode & 0o111).not.toBe(0);
    expect(lstatSync(join(destination, 'alias.md')).isSymbolicLink()).toBe(true);
  });

  it('creates the store layout when none exists yet', async () => {
    const { manager, store, root } = await newManager();
    const source = writeSkillDirectory(join(root, 'dev', 'brainstorm'));

    manager.addSkill({ name: 'brainstorm', sourcePath: source });

    expect(existsSync(join(store.paths.skills, 'brainstorm', 'SKILL.md'))).toBe(true);
  });

  it('refuses a source sitting inside the store, writing nothing', async () => {
    const { manager, store } = await newManager();
    const source = writeSkillDirectory(join(store.paths.skills, 'existing'));

    expect(() => manager.addSkill({ name: 'triage', sourcePath: source })).toThrow(PathCollisionError);
    expect(existsSync(join(store.paths.skills, 'triage'))).toBe(false);
  });

  it('throws when the destination is already there, leaving it unchanged', async () => {
    const { manager, store, root } = await newManager();
    const source = writeSkillDirectory(join(root, 'dev', 'triage'), { 'SKILL.md': 'source version' });

    writeSkillDirectory(join(store.paths.skills, 'triage'), { 'SKILL.md': 'store version' });

    expect(() => manager.addSkill({ name: 'triage', sourcePath: source })).toThrow();
    expect(readFileSync(join(store.paths.skills, 'triage', 'SKILL.md'), 'utf8')).toBe('store version');
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

/** A skill directory holding a manifest, and whatever `files` overrides or adds. */
function writeSkillDirectory(path: string, files: Record<string, string> = {}): string {
  const contents = { 'SKILL.md': '# skill\n', ...files };

  for (const [name, content] of Object.entries(contents)) {
    const filePath = join(path, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }

  return path;
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
