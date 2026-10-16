import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CollidingRegistrationError,
  DuplicateNameError,
  EntityNotFoundError,
  GrimoireError,
  InvalidNameError,
  InvalidPathError,
  InvalidShapeError,
  PathCollisionError,
} from '@/lib/errors/index';
import { tempGitRepo } from '@test-helpers/git-repo';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store/index';

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

  it('refuses a name outside the allowed alphabet, registering nothing', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    let error: unknown;
    try {
      manager.registerWorkspace({ name: 'a/b', path });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidNameError);
    expect((error as Error).message).toBe(
      'workspace name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"',
    );
    expect(manager.getRegistry().workspaces).toEqual({});
  });

  // The name is what refuses, so it refuses before anything reaches the disk —
  // asserted on the store root itself, since only `ensureLayout()` creates it.
  it('refuses an invalid name before creating the store layout', async () => {
    const { manager, store, root } = await newManager();
    const path = join(root, 'project');

    expect(() => manager.registerWorkspace({ name: 'a/b', path })).toThrow(InvalidNameError);
    expect(existsSync(store.paths.root)).toBe(false);
  });

  // A registry already holding the name is refused on load, so the name's own
  // error only surfaces because the check runs before state.json is read.
  it('refuses an invalid name before reading state.json', async () => {
    const { manager, store, root } = await newManager();

    writeState(
      store,
      document({ workspaces: { 'a/b': { path: join(root, 'taken'), autoLink: false } } }),
    );

    expect(() => manager.registerWorkspace({ name: 'a/b', path: join(root, 'other') })).toThrow(
      InvalidNameError,
    );
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

  it.each([
    ['equal to a registered repo', (repoPath: string) => repoPath, 'equals'],
    ['inside a registered repo', (repoPath: string) => join(repoPath, 'skills'), 'inside'],
    ['containing a registered repo', (repoPath: string) => dirname(repoPath), 'contains'],
  ])('refuses a path %s, creating nothing', async (_, pathFor, relation) => {
    const { manager } = await newManager();
    const repoPath = await registerNestedRepo({ manager, name: 'library' });

    const error = refusalOf(() =>
      manager.registerWorkspace({ name: 'personal', path: pathFor(repoPath) }),
    );

    expect(error).toBeInstanceOf(PathCollisionError);
    expect(error).toMatchObject({
      collision: { kind: 'repo', name: 'library', path: repoPath, relation },
    });
    expect(manager.getRegistry().workspaces).toEqual({});
    expect(existsSync(join(repoPath, 'skills'))).toBe(false);
  });

  it('names the store when the path collides with both the store and a repo', async () => {
    const workTree = await tempGitRepo();
    const manager = new GrimoireStoreManager(new GrimoireStore(join(workTree.path, '.grimoire')));
    const repoPath = join(workTree.path, 'library');

    mkdirSync(repoPath);
    manager.registerRepo({ name: 'library', path: repoPath });

    const error = refusalOf(() => manager.registerWorkspace({ name: 'personal', path: workTree.path }));

    expect(error).toBeInstanceOf(PathCollisionError);
    expect(error.message).toBe(
      `${workTree.path} contains the grimoire store (${join(workTree.path, '.grimoire')})`,
    );
  });

  it('names the first repo by name when the path collides with two', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();
    const path = join(repo.path, 'skills');

    manager.registerRepo({ name: 'zulu', path: repo.path });
    manager.registerRepo({ name: 'alpha', path: repo.path });

    expect(refusalOf(() => manager.registerWorkspace({ name: 'personal', path })).message).toBe(
      `${path} sits inside repo "alpha" (${repo.path})`,
    );
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

describe('registerRepo', () => {
  it('registers the root of a work tree, answering with the name and path', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();

    expect(manager.registerRepo({ name: 'library', path: repo.path })).toEqual({
      name: 'library',
      path: repo.path,
    });
    expect(manager.getRegistry().repos).toEqual({ library: { path: repo.path } });
  });

  it('registers a subdirectory of a work tree', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();
    const path = join(repo.path, 'packages', 'core');

    mkdirSync(path, { recursive: true });

    expect(manager.registerRepo({ name: 'core', path })).toEqual({ name: 'core', path });
  });

  it('stores the normalized path', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();

    mkdirSync(join(repo.path, 'sub'));

    const registered = manager.registerRepo({ name: 'library', path: `${repo.path}/sub/..` });

    expect(registered.path).toBe(repo.path);
    expect(manager.getRegistry().repos).toEqual({ library: { path: repo.path } });
  });

  it('registers a name that an object inherits from its prototype', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();

    manager.registerRepo({ name: 'toString', path: repo.path });

    expect(manager.getRegistry().repos).toEqual({ toString: { path: repo.path } });
  });

  it('accepts a name a workspace already holds', async () => {
    const { manager, root } = await newManager();
    const repo = await tempGitRepo();

    manager.registerWorkspace({ name: 'shared', path: join(root, 'project') });
    manager.registerRepo({ name: 'shared', path: repo.path });

    expect(Object.keys(manager.getRegistry().workspaces)).toEqual(['shared']);
    expect(Object.keys(manager.getRegistry().repos)).toEqual(['shared']);
  });

  it('accepts two repos at one path', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();

    manager.registerRepo({ name: 'first', path: repo.path });
    manager.registerRepo({ name: 'second', path: repo.path });

    expect(manager.getRegistry().repos).toEqual({
      first: { path: repo.path },
      second: { path: repo.path },
    });
  });

  it('refuses a name outside the allowed alphabet, registering nothing', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();

    const error = refusalOf(() => manager.registerRepo({ name: 'a/b', path: repo.path }));

    expect(error).toBeInstanceOf(InvalidNameError);
    expect(error.message).toBe(
      'repo name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"',
    );
    expect(manager.getRegistry().repos).toEqual({});
  });

  it('refuses a duplicate name, leaving the first registration', async () => {
    const { manager } = await newManager();
    const first = await tempGitRepo();
    const second = await tempGitRepo();

    manager.registerRepo({ name: 'library', path: first.path });

    const error = refusalOf(() => manager.registerRepo({ name: 'library', path: second.path }));

    expect(error).toBeInstanceOf(DuplicateNameError);
    expect(error.message).toBe('repo "library" is already registered');
    expect(manager.getRegistry().repos).toEqual({ library: { path: first.path } });
  });

  it.each([
    ['equal to the store root', (store: GrimoireStore) => store.paths.root],
    ['inside the store', (store: GrimoireStore) => join(store.paths.skills, 'library')],
    ['containing the store', (store: GrimoireStore) => dirname(store.paths.root)],
  ])('refuses a path %s', async (_, pathFor) => {
    const { manager, store } = await newManager();

    expect(() => manager.registerRepo({ name: 'library', path: pathFor(store) })).toThrow(
      PathCollisionError,
    );
    expect(manager.getRegistry().repos).toEqual({});
  });

  it('refuses a path that is not absolute', async () => {
    const { manager } = await newManager();

    expect(refusalOf(() => manager.registerRepo({ name: 'library', path: 'library' }))).toMatchObject({
      reason: 'not-absolute',
    });
  });

  it('refuses a path that does not exist, creating nothing', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'missing');

    const error = refusalOf(() => manager.registerRepo({ name: 'library', path }));

    expect(error).toBeInstanceOf(InvalidPathError);
    expect(error).toMatchObject({ reason: 'missing' });
    expect(existsSync(path)).toBe(false);
    expect(manager.getRegistry().repos).toEqual({});
  });

  it('refuses a path that is a file', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();
    const path = join(repo.path, 'README.md');

    writeFileSync(path, '# readme\n', 'utf8');

    expect(refusalOf(() => manager.registerRepo({ name: 'library', path }))).toMatchObject({
      reason: 'not-a-directory',
    });
  });

  it('refuses a symlink, even one that points into a work tree', async () => {
    const { manager, root } = await newManager();
    const repo = await tempGitRepo();
    const path = join(root, 'link');

    symlinkSync(repo.path, path);

    expect(refusalOf(() => manager.registerRepo({ name: 'library', path }))).toMatchObject({
      reason: 'symlink',
    });
  });

  it('refuses a directory outside every work tree, naming the path', async () => {
    const { manager, root } = await newManager();
    const path = await tempRoot();

    const error = refusalOf(() => manager.registerRepo({ name: 'library', path }));

    expect(error).toBeInstanceOf(InvalidPathError);
    expect(error.message).toBe(`${path} is not inside a git work tree`);
    expect(manager.getRegistry().repos).toEqual({});
    expect(existsSync(root)).toBe(true);
  });

  // The name is what refuses, so it refuses before anything reaches the disk —
  // asserted on the store root itself, since only `ensureLayout()` creates it.
  it('refuses an invalid name before creating the store layout', async () => {
    const { manager, store } = await newManager();
    const repo = await tempGitRepo();

    expect(() => manager.registerRepo({ name: 'a/b', path: repo.path })).toThrow(InvalidNameError);
    expect(existsSync(store.paths.root)).toBe(false);
  });

  it('refuses an invalid name before reading state.json', async () => {
    const { manager, store } = await newManager();
    const repo = await tempGitRepo();

    writeState(store, document({ repos: { 'a/b': { path: repo.path } } }));

    expect(() => manager.registerRepo({ name: 'a/b', path: repo.path })).toThrow(InvalidNameError);
  });

  it('refuses a duplicate name ahead of a missing path', async () => {
    const { manager, root } = await newManager();
    const repo = await tempGitRepo();

    manager.registerRepo({ name: 'library', path: repo.path });

    expect(() => manager.registerRepo({ name: 'library', path: join(root, 'missing') })).toThrow(
      DuplicateNameError,
    );
  });

  it('refuses a path inside the store ahead of a missing one', async () => {
    const { manager, store } = await newManager();
    const path = join(store.paths.skills, 'library');

    expect(existsSync(path)).toBe(false);
    expect(() => manager.registerRepo({ name: 'library', path })).toThrow(PathCollisionError);
  });

  it('reports a missing path rather than a missing work tree', async () => {
    const { manager, root } = await newManager();
    const error = refusalOf(() => manager.registerRepo({ name: 'library', path: join(root, 'nope') }));

    expect(error).toMatchObject({ reason: 'missing' });
  });

  it.each([
    ['equal to a registered workspace', (workspacePath: string) => workspacePath, 'equals'],
    [
      'inside a registered workspace',
      (workspacePath: string) => join(workspacePath, 'nested'),
      'inside',
    ],
    ['containing a registered workspace', (workspacePath: string) => dirname(workspacePath), 'contains'],
  ])('refuses a path %s, registering nothing', async (_, pathFor, relation) => {
    const { manager } = await newManager();
    const workTree = await tempGitRepo();
    const workspacePath = join(workTree.path, 'agents', 'skills');

    mkdirSync(join(workspacePath, 'nested'), { recursive: true });
    manager.registerWorkspace({ name: 'personal', path: workspacePath });

    const error = refusalOf(() =>
      manager.registerRepo({ name: 'library', path: pathFor(workspacePath) }),
    );

    expect(error).toBeInstanceOf(PathCollisionError);
    expect(error).toMatchObject({
      collision: { kind: 'workspace', name: 'personal', path: workspacePath, relation },
    });
    expect(manager.getRegistry().repos).toEqual({});
  });

  it('refuses a path inside a workspace ahead of a missing one', async () => {
    const { manager, root } = await newManager();
    const workspacePath = join(root, 'project');
    const path = join(workspacePath, 'missing');

    manager.registerWorkspace({ name: 'personal', path: workspacePath });

    expect(existsSync(path)).toBe(false);
    expect(() => manager.registerRepo({ name: 'library', path })).toThrow(PathCollisionError);
  });

  it('refuses a path inside a workspace ahead of one outside every work tree', async () => {
    const { manager } = await newManager();
    const workspacePath = await tempRoot();
    const path = join(workspacePath, 'plain');

    mkdirSync(path);
    manager.registerWorkspace({ name: 'personal', path: workspacePath });

    expect(() => manager.registerRepo({ name: 'library', path })).toThrow(PathCollisionError);
  });

  it('accepts a repo inside another repo', async () => {
    const { manager } = await newManager();
    const outer = await tempGitRepo();
    const inner = join(outer.path, 'packages', 'core');

    mkdirSync(inner, { recursive: true });
    manager.registerRepo({ name: 'outer', path: outer.path });
    manager.registerRepo({ name: 'inner', path: inner });

    expect(manager.getRegistry().repos).toEqual({
      outer: { path: outer.path },
      inner: { path: inner },
    });
  });
});

describe('requireRegisteredRepo', () => {
  it('returns the registered repo', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();

    manager.registerRepo({ name: 'library', path: repo.path });

    expect(manager.requireRegisteredRepo('library')).toEqual({ name: 'library', path: repo.path });
  });

  it.each(['ghost', 'toString'])('refuses the unregistered name %j', async (name) => {
    const { manager } = await newManager();

    const error = refusalOf(() => manager.requireRegisteredRepo(name));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe(`no repo named "${name}"`);
  });

  it('does not find a workspace of that name', async () => {
    const { manager, root } = await newManager();

    manager.registerWorkspace({ name: 'personal', path: join(root, 'project') });

    expect(() => manager.requireRegisteredRepo('personal')).toThrow(EntityNotFoundError);
  });
});

describe('unregisterRepo', () => {
  it('answers with the repo it dropped, and frees the name', async () => {
    const { manager } = await newManager();
    const first = await tempGitRepo();
    const second = await tempGitRepo();

    manager.registerRepo({ name: 'library', path: first.path });

    expect(manager.unregisterRepo('library')).toEqual({ name: 'library', path: first.path });
    expect(manager.getRegistry().repos).toEqual({});
    expect(() => manager.registerRepo({ name: 'library', path: second.path })).not.toThrow();
  });

  it('leaves other repos, workspaces, clone records, ignore, and the directory alone', async () => {
    const { manager, store, root } = await newManager();
    const dropped = await tempGitRepo();
    const kept = await tempGitRepo();
    const workspace = join(root, 'project');

    writeState(
      store,
      JSON.stringify({
        workspaces: { personal: { path: workspace, autoLink: false } },
        repos: {
          dropped: { path: dropped.path },
          kept: { path: kept.path },
        },
        skills: { deploy: { clones: [{ workspace: 'personal' }, { path: '/elsewhere' }] } },
        ignore: ['.git'],
      }),
    );
    writeFileSync(join(dropped.path, 'notes.md'), 'kept', 'utf8');

    manager.unregisterRepo('dropped');

    expect(manager.getRegistry()).toEqual({
      workspaces: { personal: { path: workspace, autoLink: false } },
      repos: { kept: { path: kept.path } },
      skills: { deploy: { clones: [{ workspace: 'personal' }, { path: '/elsewhere' }] } },
      ignore: ['.git'],
    });
    expect(existsSync(join(dropped.path, 'notes.md'))).toBe(true);
  });

  it.each(['ghost', 'toString'])(
    'refuses the unregistered name %j, leaving the registry',
    async (name) => {
      const { manager } = await newManager();
      const repo = await tempGitRepo();

      manager.registerRepo({ name: 'library', path: repo.path });

      expect(() => manager.unregisterRepo(name)).toThrow(EntityNotFoundError);
      expect(manager.getRegistry().repos).toEqual({ library: { path: repo.path } });
    },
  );
});

describe('renameRepo', () => {
  const repos = { library: { path: '/repos/library' }, docs: { path: '/repos/docs' } };

  /** A manager whose state.json holds `repos` and whatever other `sections` a test adds. */
  const seededManager = (sections: DocumentSections = {}) => seededStore({ repos, ...sections });

  it('answers with the renamed repo, filing only the key under the new name', async () => {
    const { manager } = await seededManager();

    expect(manager.renameRepo({ name: 'library', newName: 'fresh' })).toEqual({
      repo: { name: 'fresh', path: '/repos/library' },
      renamed: true,
    });
    expect(manager.getRegistry().repos).toEqual({
      fresh: { path: '/repos/library' },
      docs: { path: '/repos/docs' },
    });
  });

  it('leaves workspaces, clone records and ignore alone, even a workspace with the old name', async () => {
    const sections = {
      workspaces: { library: { path: '/work/project', autoLink: false } },
      skills: { deploy: { clones: [{ workspace: 'library' }, { path: '/elsewhere' }] } },
      ignore: ['.git'],
    };
    const { manager } = await seededManager(sections);

    manager.renameRepo({ name: 'library', newName: 'fresh' });

    expect(manager.getRegistry()).toEqual({
      ...sections,
      repos: { fresh: { path: '/repos/library' }, docs: { path: '/repos/docs' } },
    });
  });

  it('renames a repo whose directory is gone', async () => {
    const { manager } = await newManager();
    const repo = await tempGitRepo();

    manager.registerRepo({ name: 'library', path: repo.path });
    rmSync(repo.path, { recursive: true, force: true });

    manager.renameRepo({ name: 'library', newName: 'fresh' });

    expect(manager.getRegistry().repos).toEqual({ fresh: { path: repo.path } });
  });

  it("renames to a registered workspace's name", async () => {
    const { manager } = await seededManager({
      workspaces: { personal: { path: '/work/project', autoLink: false } },
    });

    expect(manager.renameRepo({ name: 'library', newName: 'personal' }).renamed).toBe(true);
    expect(manager.getRegistry().repos).toEqual({ personal: repos.library, docs: repos.docs });
  });

  it('treats a change of case as a rename', async () => {
    const { manager } = await seededManager();

    expect(manager.renameRepo({ name: 'library', newName: 'Library' }).renamed).toBe(true);
    expect(manager.getRegistry().repos).toEqual({ Library: repos.library, docs: repos.docs });
  });

  it('writes nothing when the new name is the current one', async () => {
    const { manager, store, contents } = await seededManager();

    expect(manager.renameRepo({ name: 'library', newName: 'library' })).toEqual({
      repo: { name: 'library', path: '/repos/library' },
      renamed: false,
    });
    expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
  });

  describe('refusals, each leaving the registry', () => {
    it.each(['ghost', 'toString'])('refuses the unregistered name %j', async (name) => {
      const { manager } = await seededManager();

      const error = refusalOf(() => manager.renameRepo({ name, newName: 'fresh' }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe(`no repo named "${name}"`);
      expect(manager.getRegistry().repos).toEqual(repos);
    });

    it('refuses an unregistered name renamed to itself', async () => {
      const { manager } = await seededManager();

      const error = refusalOf(() => manager.renameRepo({ name: 'ghost', newName: 'ghost' }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(manager.getRegistry().repos).toEqual(repos);
    });

    it('refuses a new name that breaks the name rule, naming it', async () => {
      const { manager } = await seededManager();

      const error = refusalOf(() => manager.renameRepo({ name: 'library', newName: 'a/b' }));

      expect(error).toBeInstanceOf(InvalidNameError);
      expect(error.message).toContain('"a/b"');
      expect(manager.getRegistry().repos).toEqual(repos);
    });

    it('refuses a new name another repo holds, naming it', async () => {
      const { manager } = await seededManager();

      const error = refusalOf(() => manager.renameRepo({ name: 'library', newName: 'docs' }));

      expect(error).toBeInstanceOf(DuplicateNameError);
      expect(error.message).toBe('repo "docs" is already registered');
      expect(manager.getRegistry().repos).toEqual(repos);
    });
  });
});

describe('listRegisteredRepos', () => {
  it('lists nothing for an empty registry', async () => {
    const { manager } = await newManager();

    expect(manager.listRegisteredRepos()).toEqual([]);
  });

  it('lists every repo, sorted by name', async () => {
    const { manager } = await newManager();
    const zulu = await tempGitRepo();
    const alpha = await tempGitRepo();

    manager.registerRepo({ name: 'zulu', path: zulu.path });
    manager.registerRepo({ name: 'alpha', path: alpha.path });

    expect(manager.listRegisteredRepos()).toEqual([
      { name: 'alpha', path: alpha.path },
      { name: 'zulu', path: zulu.path },
    ]);
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

    expect(manager.getRegistry()).toEqual({
      workspaces: {},
      repos: {},
      skills: {},
      ignore: ['.DS_Store'],
    });
  });

  it('refuses a file that is not valid JSON, naming it', async () => {
    const { manager, store } = await newManager();

    writeState(store, '{ "workspaces": ');

    expect(refusal(() => manager.getRegistry()).message).toContain(store.paths.state);
  });

  it('refuses an unrecognized key, naming it', async () => {
    const { manager, store } = await newManager();

    writeState(store, '{ "remotes": {}, "workspaces": {} }');

    expect(refusal(() => manager.getRegistry()).message).toContain('remotes');
  });

  it('refuses a wrong-typed field, naming the entry', async () => {
    const { manager, store } = await newManager();

    writeState(store, '{ "workspaces": { "personal": { "path": "/x", "autoLink": "yes" } } }');

    expect(refusal(() => manager.getRegistry()).message).toContain('personal');
  });

  // `unclone` reads any target outside the name alphabet as a path, so a
  // hand-written name like this one could never be addressed by name.
  it('refuses a workspace name outside the allowed alphabet, naming it', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ workspaces: { 'my.project': { path: '/x', autoLink: false } } }));

    const { message } = refusal(() => manager.getRegistry());

    expect(message).toContain('workspaces["my.project"]');
    expect(message).toContain('workspace name must start with a letter or digit');
  });

  it('refuses a repo name outside the allowed alphabet, naming it', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ repos: { 'my.project': { path: '/x' } } }));

    const { message } = refusal(() => manager.getRegistry());

    expect(message).toContain('repos["my.project"]');
    expect(message).toContain('repo name must start with a letter or digit');
  });

  it('refuses a wrong-typed repo path, naming the entry', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ repos: { library: { path: 42 } } }));

    expect(refusal(() => manager.getRegistry()).message).toContain('library');
  });

  it('refuses an unrecognized key in a repo entry, naming it', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ repos: { library: { path: '/x', autoLink: true } } }));

    expect(refusal(() => manager.getRegistry()).message).toContain('autoLink');
  });

  it('refuses a clone record naming a workspace outside the allowed alphabet, naming it', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: { deploy: { clones: [{ workspace: 'a/b' }] } } }));

    const { message } = refusal(() => manager.getRegistry());

    expect(message).toContain('skills.deploy.clones[0].workspace');
    expect(message).toContain('workspace name must start with a letter or digit');
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

describe('a registered repo path that touches the store', () => {
  it.each([
    ['sitting inside the store', (store: GrimoireStore) => join(store.paths.skills, 'bad')],
    ['equal to the store root', (store: GrimoireStore) => store.paths.root],
    ['containing the store', (store: GrimoireStore) => dirname(store.paths.root)],
  ])('refuses a path %s, naming the repo and the file it has to leave', async (_, pathFor) => {
    const { manager, store } = await newManager();

    writeState(store, document({ repos: { bad: { path: pathFor(store) } } }));

    const error = refusalOf(() => manager.getRegistry());

    expect(error).toBeInstanceOf(CollidingRegistrationError);
    expect(error.message).toMatch(new RegExp(`^repo "bad" cannot be used:.*\\n.*${store.paths.state}`));
  });

  it.each([
    ['getRegistry', (manager: GrimoireStoreManager) => manager.getRegistry()],
    ['listRegisteredRepos', (manager: GrimoireStoreManager) => manager.listRegisteredRepos()],
    ['requireRegisteredRepo', (manager: GrimoireStoreManager) => manager.requireRegisteredRepo('ok')],
    ['unregisterRepo', (manager: GrimoireStoreManager) => manager.unregisterRepo('ok')],
    [
      'registerRepo',
      (manager: GrimoireStoreManager) => manager.registerRepo({ name: 'new', path: '/tmp/new' }),
    ],
    ['listRegisteredWorkspaces', (manager: GrimoireStoreManager) => manager.listRegisteredWorkspaces()],
    [
      'registerWorkspace',
      (manager: GrimoireStoreManager) => manager.registerWorkspace({ name: 'new', path: '/tmp/new' }),
    ],
  ])('refuses %s while the repo is registered', async (_, read) => {
    const { manager, store, root } = await newManager();

    writeState(
      store,
      document({
        repos: {
          bad: { path: join(store.paths.skills, 'bad') },
          ok: { path: join(root, 'ok') },
        },
      }),
    );

    expect(() => read(manager)).toThrow(CollidingRegistrationError);
  });

  it('names the workspace when a workspace and a repo both collide', async () => {
    const { manager, store } = await newManager();

    writeState(
      store,
      document({
        workspaces: { zulu: { path: join(store.paths.skills, 'zulu'), autoLink: false } },
        repos: { alpha: { path: join(store.paths.skills, 'alpha') } },
      }),
    );

    expect(() => manager.getRegistry()).toThrow(/^workspace "zulu" cannot be used:/);
  });

  it('names the first repo by name when several collide', async () => {
    const { manager, store } = await newManager();

    writeState(
      store,
      document({
        repos: {
          zulu: { path: join(store.paths.skills, 'zulu') },
          alpha: { path: join(store.paths.skills, 'alpha') },
        },
      }),
    );

    expect(() => manager.getRegistry()).toThrow(/^repo "alpha" cannot be used:/);
  });
});

describe('a workspace and a repo whose paths overlap', () => {
  it.each([
    ['inside', (repoPath: string) => join(repoPath, 'skills')],
    ['equal to', (repoPath: string) => repoPath],
    ['containing', (repoPath: string) => dirname(repoPath)],
  ])('refuses a workspace %s a repo', async (_, workspacePathFor) => {
    const { manager, store, root } = await newManager();
    const repoPath = join(root, 'code', 'dotfiles');

    writeState(
      store,
      document({
        workspaces: { dotfiles: { path: workspacePathFor(repoPath), autoLink: false } },
        repos: { library: { path: repoPath } },
      }),
    );

    expect(() => manager.getRegistry()).toThrow(CollidingRegistrationError);
  });

  it('names the workspace, the repo, and the file one of them has to leave', async () => {
    const { manager, store, root } = await newManager();

    writeState(store, overlappingDocument(root));

    expect(() => manager.getRegistry()).toThrow(
      new RegExp(
        `^workspace "dotfiles" .* repo "library" .*\\n.*one of them is gone from ${store.paths.state}$`,
      ),
    );
  });

  it.each([
    ['getRegistry', (manager: GrimoireStoreManager) => manager.getRegistry()],
    ['listRegisteredWorkspaces', (manager: GrimoireStoreManager) => manager.listRegisteredWorkspaces()],
    [
      'requireRegisteredWorkspace',
      (manager: GrimoireStoreManager) => manager.requireRegisteredWorkspace('dotfiles'),
    ],
    ['unregisterWorkspace', (manager: GrimoireStoreManager) => manager.unregisterWorkspace('dotfiles')],
    [
      'registerWorkspace',
      (manager: GrimoireStoreManager) => manager.registerWorkspace({ name: 'new', path: '/tmp/new' }),
    ],
    ['listRegisteredRepos', (manager: GrimoireStoreManager) => manager.listRegisteredRepos()],
    [
      'requireRegisteredRepo',
      (manager: GrimoireStoreManager) => manager.requireRegisteredRepo('library'),
    ],
    ['unregisterRepo', (manager: GrimoireStoreManager) => manager.unregisterRepo('library')],
    [
      'registerRepo',
      (manager: GrimoireStoreManager) => manager.registerRepo({ name: 'new', path: '/tmp/new' }),
    ],
  ])('refuses %s while the overlap is registered', async (_, read) => {
    const { manager, store, root } = await newManager();

    writeState(store, overlappingDocument(root));

    expect(() => read(manager)).toThrow(CollidingRegistrationError);
  });

  it('names the first workspace by name when several overlap a repo', async () => {
    const { manager, store, root } = await newManager();
    const repoPath = join(root, 'dotfiles');

    writeState(
      store,
      document({
        workspaces: {
          zulu: { path: join(repoPath, 'zulu'), autoLink: false },
          alpha: { path: join(repoPath, 'alpha'), autoLink: false },
        },
        repos: { library: { path: repoPath } },
      }),
    );

    expect(() => manager.getRegistry()).toThrow(/^workspace "alpha" cannot be used:/);
  });

  it('names the first repo by name when a workspace overlaps several', async () => {
    const { manager, store, root } = await newManager();
    const repoPath = join(root, 'dotfiles');

    writeState(
      store,
      document({
        workspaces: { dotfiles: { path: join(repoPath, 'skills'), autoLink: false } },
        repos: { zulu: { path: repoPath }, alpha: { path: repoPath } },
      }),
    );

    expect(() => manager.getRegistry()).toThrow(/sits inside repo "alpha"/);
  });

  it('refuses a workspace whose ancestor symlink was repointed into a repo after registration', async () => {
    const { manager, root } = await newManager();
    const repo = await tempGitRepo();
    const link = join(root, 'link');

    mkdirSync(join(root, 'elsewhere'));
    symlinkSync(join(root, 'elsewhere'), link);
    manager.registerRepo({ name: 'library', path: repo.path });
    manager.registerWorkspace({ name: 'personal', path: join(link, 'skills') });

    rmSync(link);
    symlinkSync(repo.path, link);

    const error = refusalOf(() => manager.getRegistry());

    expect(error).toBeInstanceOf(CollidingRegistrationError);
    expect(error.message).toMatch(/^workspace "personal" .* sits inside repo "library"/);
  });

  it('reports a workspace touching the store ahead of an earlier-named one overlapping a repo', async () => {
    const { manager, store, root } = await newManager();
    const repoPath = join(root, 'dotfiles');

    writeState(
      store,
      document({
        workspaces: {
          alpha: { path: join(repoPath, 'skills'), autoLink: false },
          zulu: { path: join(store.paths.skills, 'zulu'), autoLink: false },
        },
        repos: { library: { path: repoPath } },
      }),
    );

    expect(() => manager.getRegistry()).toThrow(
      /^workspace "zulu" cannot be used: .* the grimoire store/,
    );
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

describe('renameWorkspace', () => {
  const workspaces = {
    personal: { path: '/work/personal', autoLink: true },
    work: { path: '/work/job', autoLink: false },
  };

  /** A manager whose state.json holds `workspaces` and whatever other `sections` a test adds. */
  const seededManager = (sections: DocumentSections = {}) => seededStore({ workspaces, ...sections });

  it('answers with the renamed workspace, keeping its path and auto-link setting', async () => {
    const { manager } = await seededManager();

    expect(manager.renameWorkspace({ name: 'personal', newName: 'fresh' })).toEqual({
      workspace: { name: 'fresh', path: '/work/personal', autoLink: true },
      renamed: true,
    });
    expect(manager.getRegistry().workspaces).toEqual({
      fresh: workspaces.personal,
      work: workspaces.work,
    });
  });

  it("rewrites the workspace's clone records in order, leaving every other record and section alone", async () => {
    const sections = {
      repos: { personal: { path: '/repos/personal' } },
      skills: {
        deploy: {
          clones: [{ workspace: 'personal' }, { path: '/elsewhere' }, { workspace: 'work' }],
        },
        triage: { clones: [{ workspace: 'work' }, { workspace: 'personal' }] },
        review: { clones: [] },
      },
      ignore: ['.git'],
    };
    const { manager } = await seededManager(sections);

    manager.renameWorkspace({ name: 'personal', newName: 'fresh' });

    expect(manager.getRegistry()).toEqual({
      workspaces: { fresh: workspaces.personal, work: workspaces.work },
      repos: sections.repos,
      skills: {
        deploy: {
          clones: [{ workspace: 'fresh' }, { path: '/elsewhere' }, { workspace: 'work' }],
        },
        triage: { clones: [{ workspace: 'work' }, { workspace: 'fresh' }] },
        review: { clones: [] },
      },
      ignore: ['.git'],
    });
  });

  it("renames to a registered repo's name", async () => {
    const { manager } = await seededManager({ repos: { library: { path: '/repos/library' } } });

    expect(manager.renameWorkspace({ name: 'personal', newName: 'library' }).renamed).toBe(true);
    expect(manager.getRegistry().workspaces).toEqual({
      library: workspaces.personal,
      work: workspaces.work,
    });
  });

  it('treats a change of case as a rename', async () => {
    const { manager } = await seededManager();

    expect(manager.renameWorkspace({ name: 'personal', newName: 'Personal' }).renamed).toBe(true);
    expect(manager.getRegistry().workspaces).toEqual({
      Personal: workspaces.personal,
      work: workspaces.work,
    });
  });

  it('renames to a name an object inherits from its prototype', async () => {
    const { manager } = await seededManager();

    expect(manager.renameWorkspace({ name: 'personal', newName: 'toString' }).renamed).toBe(true);
    expect(manager.getRegistry().workspaces).toEqual({
      toString: workspaces.personal,
      work: workspaces.work,
    });
  });

  it('renames a workspace whose directory is gone', async () => {
    const { manager, root } = await newManager();
    const path = join(root, 'project');

    manager.registerWorkspace({ name: 'personal', path });
    rmSync(path, { recursive: true, force: true });

    manager.renameWorkspace({ name: 'personal', newName: 'fresh' });

    expect(manager.getRegistry().workspaces).toEqual({ fresh: { path, autoLink: false } });
  });

  it('keeps a record already naming the new name, which now resolves to the renamed workspace', async () => {
    const { manager } = await seededManager({
      skills: { deploy: { clones: [{ workspace: 'fresh' }] } },
    });

    manager.renameWorkspace({ name: 'personal', newName: 'fresh' });

    expect(manager.listSkillClones('deploy')).toEqual([
      {
        origin: 'fresh',
        path: join('/work/personal', 'deploy'),
        record: { workspace: 'fresh' },
      },
    ]);
  });

  it('writes nothing when the new name is the current one', async () => {
    const { manager, store, contents } = await seededManager({
      skills: { deploy: { clones: [{ workspace: 'personal' }] } },
    });

    expect(manager.renameWorkspace({ name: 'personal', newName: 'personal' })).toEqual({
      workspace: { name: 'personal', path: '/work/personal', autoLink: true },
      renamed: false,
    });
    expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
  });

  describe('refusals, each leaving state.json', () => {
    it.each(['ghost', 'toString'])('refuses the unregistered name %j', async (name) => {
      const { manager, store, contents } = await seededManager();

      const error = refusalOf(() => manager.renameWorkspace({ name, newName: 'fresh' }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe(`no workspace named "${name}"`);
      expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
    });

    it('refuses an unregistered name renamed to itself', async () => {
      const { manager, store, contents } = await seededManager();

      const error = refusalOf(() => manager.renameWorkspace({ name: 'ghost', newName: 'ghost' }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
    });

    it('refuses a new name that breaks the name rule, naming it', async () => {
      const { manager, store, contents } = await seededManager();

      const error = refusalOf(() => manager.renameWorkspace({ name: 'personal', newName: 'a/b' }));

      expect(error).toBeInstanceOf(InvalidNameError);
      expect(error.message).toContain('"a/b"');
      expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
    });

    it('refuses a new name another workspace holds, naming it', async () => {
      const { manager, store, contents } = await seededManager();

      const error = refusalOf(() => manager.renameWorkspace({ name: 'personal', newName: 'work' }));

      expect(error).toBeInstanceOf(DuplicateNameError);
      expect(error.message).toBe('workspace "work" is already registered');
      expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
    });
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

describe('findDanglingLinksFromWorkspace', () => {
  it("answers with the workspace's links into the store that resolve nowhere, sorted by entry", async () => {
    const { manager, store, root } = await newManager();
    const workspace = join(root, 'project');

    mkdirSync(workspace, { recursive: true });
    manager.registerWorkspace({ name: 'personal', path: workspace });
    symlinkSync(join(store.paths.skills, 'triage'), join(workspace, 'triage'));
    symlinkSync(join(store.paths.skills, 'brainstorm'), join(workspace, 'brainstorm'));

    expect(manager.findDanglingLinksFromWorkspace('personal')).toEqual([
      { entry: 'brainstorm', target: join(store.paths.skills, 'brainstorm') },
      { entry: 'triage', target: join(store.paths.skills, 'triage') },
    ]);
  });

  it('leaves out a live link', async () => {
    const { manager, store, root } = await newManager();
    const workspace = join(root, 'project');

    mkdirSync(workspace, { recursive: true });
    manager.registerWorkspace({ name: 'personal', path: workspace });
    linkSkill({ store, workspace, skill: 'triage' });

    expect(manager.findDanglingLinksFromWorkspace('personal')).toEqual([]);
  });

  it('refuses a name registered nowhere', async () => {
    const { manager } = await newManager();

    expect(() => manager.findDanglingLinksFromWorkspace('ghost')).toThrow(EntityNotFoundError);
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

    writeState(store, document({ skills: { triage: { clones: [{ path: '/b' }, { path: '/a' }] } } }));

    expect(manager.listSkillClones('triage').map(({ origin }) => origin)).toEqual(['/b', '/a']);
  });
});

describe('listFiledClones', () => {
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

    expect(manager.listFiledClones()).toEqual([
      { skill: 'triage', record, path: join(workspace, 'triage') },
    ]);
  });

  it('normalizes a path record spelled with a trailing separator', async () => {
    const { manager, store } = await newManager();
    const record = { path: `/projects/app${sep}` };

    writeState(store, document({ skills: { triage: { clones: [record] } } }));

    expect(manager.listFiledClones()).toEqual([
      { skill: 'triage', record, path: join('/projects/app', 'triage') },
    ]);
  });

  it('expands a path record that starts with ~', async () => {
    const { manager, store } = await newManager();
    const record = { path: '~/old' };

    writeState(store, document({ skills: { triage: { clones: [record] } } }));

    expect(manager.listFiledClones()).toEqual([
      { skill: 'triage', record, path: join(homedir(), 'old', 'triage') },
    ]);
  });

  it('keeps a record naming a workspace that is not registered, with no path', async () => {
    const { manager, store } = await newManager();
    const record = { workspace: 'ghost' };

    writeState(store, document({ skills: { triage: { clones: [record] } } }));

    expect(manager.listFiledClones()).toEqual([{ skill: 'triage', record, path: undefined }]);
  });

  it('sorts by skill name and keeps record order within a skill', async () => {
    const { manager, store } = await newManager();

    writeState(
      store,
      document({
        skills: {
          triage: { clones: [{ path: '/b' }, { path: '/a' }] },
          deploy: { clones: [{ path: '/c' }] },
        },
      }),
    );

    expect(manager.listFiledClones().map(({ skill, path }) => [skill, path])).toEqual([
      ['deploy', join('/c', 'deploy')],
      ['triage', join('/b', 'triage')],
      ['triage', join('/a', 'triage')],
    ]);
  });

  it('answers nothing when the document holds no skills', async () => {
    const { manager } = await newManager();

    expect(manager.listFiledClones()).toEqual([]);
  });
});

describe('findSkillClone', () => {
  it('matches a workspace record when directory is the registered path', async () => {
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

    expect(manager.findSkillClone({ skill: 'triage', directory: workspace })).toEqual({
      origin: 'personal',
      path: join(workspace, 'triage'),
      record,
    });
  });

  it('matches a path record when directory is the recorded path', async () => {
    const { manager, store } = await newManager();
    const record = { path: '/projects/app' };

    writeState(store, document({ skills: { triage: { clones: [record] } } }));

    expect(manager.findSkillClone({ skill: 'triage', directory: '/projects/app' })).toEqual({
      origin: '/projects/app',
      path: '/projects/app/triage',
      record,
    });
  });

  // The symlink has to sit in an ancestor segment: `toRegisteredPath` refuses a
  // symlink as the path being registered, so a workspace can never be
  // registered at `<root>/link` itself.
  it('matches a workspace record through a symlinked ancestor, queried by the real path', async () => {
    const { manager, store, root } = await newManager();
    const real = join(root, 'dotfiles', 'claude', 'skills');
    const registered = join(root, '.claude', 'skills');
    const record = { workspace: 'personal' };

    mkdirSync(real, { recursive: true });
    symlinkSync(join(root, 'dotfiles', 'claude'), join(root, '.claude'));
    writeState(
      store,
      document({
        workspaces: { personal: { path: registered, autoLink: false } },
        skills: { triage: { clones: [record] } },
      }),
    );

    expect(manager.findSkillClone({ skill: 'triage', directory: real })).toEqual({
      origin: 'personal',
      path: join(registered, 'triage'),
      record,
    });
  });

  it('matches a path record holding the real path, queried through a symlinked ancestor', async () => {
    const { manager, store, root } = await newManager();
    const real = join(root, 'dotfiles', 'claude', 'skills');
    const viaLink = join(root, '.claude', 'skills');
    const record = { path: real };

    mkdirSync(real, { recursive: true });
    symlinkSync(join(root, 'dotfiles', 'claude'), join(root, '.claude'));
    writeState(store, document({ skills: { triage: { clones: [record] } } }));

    expect(manager.findSkillClone({ skill: 'triage', directory: viaLink })).toEqual({
      origin: real,
      path: join(real, 'triage'),
      record,
    });
  });

  it('never matches through an unregistered workspace, even with a matching sibling', async () => {
    const { manager, store } = await newManager();
    const sibling = { path: '/projects/app' };

    writeState(store, document({ skills: { triage: { clones: [{ workspace: 'ghost' }, sibling] } } }));

    expect(manager.findSkillClone({ skill: 'triage', directory: '/projects/app' })).toEqual({
      origin: '/projects/app',
      path: '/projects/app/triage',
      record: sibling,
    });
  });

  it('matches a recorded path spelled with a trailing separator', async () => {
    const { manager, store, root } = await newManager();
    const canonical = join(root, 'app');
    const record = { path: `${canonical}${sep}` };

    writeState(store, document({ skills: { triage: { clones: [record] } } }));

    expect(manager.findSkillClone({ skill: 'triage', directory: canonical })).toEqual({
      origin: record.path,
      path: join(record.path, 'triage'),
      record,
    });
  });

  it('matches when the queried directory is spelled with a `..` segment', async () => {
    const { manager, store, root } = await newManager();
    const canonical = join(root, 'app');
    const record = { path: canonical };

    writeState(store, document({ skills: { triage: { clones: [record] } } }));

    expect(
      manager.findSkillClone({ skill: 'triage', directory: join(canonical, 'sibling', '..') }),
    ).toEqual({ origin: canonical, path: join(canonical, 'triage'), record });
  });

  it('answers undefined for a record naming a different directory', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: { triage: { clones: [{ path: '/elsewhere' }] } } }));

    expect(manager.findSkillClone({ skill: 'triage', directory: '/projects/app' })).toBeUndefined();
  });

  it('answers undefined for a skill with no entry', async () => {
    const { manager } = await newManager();

    expect(manager.findSkillClone({ skill: 'triage', directory: '/projects/app' })).toBeUndefined();
  });

  // Every object answers to `toString`, so a lookup rather than `Object.hasOwn`
  // reads an empty document as holding the skill.
  it('answers undefined for a skill named after an inherited property', async () => {
    const { manager } = await newManager();

    expect(manager.findSkillClone({ skill: 'toString', directory: '/projects/app' })).toBeUndefined();
  });

  it('answers with the first of two records resolving to one directory', async () => {
    const { manager, store } = await newManager();
    const first = { path: '/projects/app' };
    const second = { path: '/projects/app/' };

    writeState(store, document({ skills: { triage: { clones: [first, second] } } }));

    expect(manager.findSkillClone({ skill: 'triage', directory: '/projects/app' })?.record).toEqual(
      first,
    );
  });
});

describe('recordClone', () => {
  it("creates the skill's entry when it has none", async () => {
    const { manager, root } = await newManager();

    manager.registerWorkspace({ name: 'personal', path: join(root, 'personal') });
    manager.recordClone({ skill: 'triage', workspace: 'personal' });

    expect(manager.getRegistry().skills).toEqual({ triage: { clones: [{ workspace: 'personal' }] } });
  });

  it('appends after an existing record, keeping order, leaving other skills and workspaces alone', async () => {
    const { manager, store, root } = await newManager();
    const workspaces = { personal: { path: join(root, 'personal'), autoLink: false } };

    manager.registerWorkspace({ name: 'personal', path: workspaces.personal.path });
    writeState(
      store,
      document({
        workspaces,
        skills: {
          triage: { clones: [{ path: '/elsewhere' }] },
          deploy: { clones: [{ path: '/keep' }] },
        },
      }),
    );
    manager.recordClone({ skill: 'triage', workspace: 'personal' });

    expect(manager.getRegistry().skills).toEqual({
      triage: { clones: [{ path: '/elsewhere' }, { workspace: 'personal' }] },
      deploy: { clones: [{ path: '/keep' }] },
    });
    expect(manager.getRegistry().workspaces).toEqual(workspaces);
  });

  it('writes nothing when that exact record already exists', async () => {
    const { manager, store, root } = await newManager();
    const path = join(root, 'personal');

    manager.registerWorkspace({ name: 'personal', path });

    const contents = document({
      workspaces: { personal: { path, autoLink: false } },
      skills: { triage: { clones: [{ workspace: 'personal' }] } },
    });

    writeState(store, contents);
    manager.recordClone({ skill: 'triage', workspace: 'personal' });

    expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
  });

  // The canonical guard from context.md's Approach: recordClone matches through
  // findSkillClone, not record equality, so a { path } record naming the same
  // directory blocks the write even though it is a different record.
  it('writes nothing when a path record already names the same directory, through the other arm', async () => {
    const { manager, store, root } = await newManager();
    const path = join(root, 'personal');

    manager.registerWorkspace({ name: 'personal', path });

    const contents = document({
      workspaces: { personal: { path, autoLink: false } },
      skills: { triage: { clones: [{ path }] } },
    });

    writeState(store, contents);
    manager.recordClone({ skill: 'triage', workspace: 'personal' });

    expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
  });

  it('throws EntityNotFoundError when the workspace is not registered, writing nothing', async () => {
    const { manager, store } = await newManager();
    const contents = document({ skills: { triage: { clones: [] } } });

    writeState(store, contents);

    expect(() => manager.recordClone({ skill: 'triage', workspace: 'personal' })).toThrow(
      EntityNotFoundError,
    );
    expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
  });
});

describe('forgetClone', () => {
  it("keeps the skill's key with clones: [] once its last record is dropped", async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: { triage: { clones: [{ path: '/a' }] } } }));
    manager.forgetClone({ skill: 'triage', record: { path: '/a' } });

    expect(manager.getRegistry().skills).toEqual({ triage: { clones: [] } });
  });

  // findSkillClone matches canonically, across arms; forgetClone acts on the
  // literal record — dropping a { workspace } record leaves a { path } sibling
  // naming the same directory untouched.
  it('leaves a sibling record that resolves to the same directory through the other arm', async () => {
    const { manager, store, root } = await newManager();
    const path = join(root, 'personal');

    writeState(
      store,
      document({
        workspaces: { personal: { path, autoLink: false } },
        skills: { triage: { clones: [{ workspace: 'personal' }, { path }] } },
      }),
    );
    manager.forgetClone({ skill: 'triage', record: { workspace: 'personal' } });

    expect(manager.getRegistry().skills).toEqual({ triage: { clones: [{ path }] } });
  });

  it('leaves other skills and the workspaces section alone', async () => {
    const { manager, store } = await newManager();
    const workspaces = { personal: { path: '/ws', autoLink: false } };

    writeState(
      store,
      document({
        workspaces,
        skills: {
          triage: { clones: [{ path: '/a' }] },
          deploy: { clones: [{ path: '/keep' }] },
        },
      }),
    );
    manager.forgetClone({ skill: 'triage', record: { path: '/a' } });

    expect(manager.getRegistry().skills.deploy).toEqual({ clones: [{ path: '/keep' }] });
    expect(manager.getRegistry().workspaces).toEqual(workspaces);
  });

  it.each([
    [
      'a record that was never there',
      'triage',
      { path: '/never' },
      { triage: { clones: [{ path: '/a' }] } },
    ],
    ['a skill with no entry', 'ghost', { path: '/a' }, { triage: { clones: [{ path: '/a' }] } }],
    ['a skill named toString', 'toString', { path: '/a' }, { triage: { clones: [{ path: '/a' }] } }],
  ])('writes nothing for %s', async (_, skill, record, skills) => {
    const { manager, store } = await newManager();
    const contents = document({ skills });

    writeState(store, contents);
    manager.forgetClone({ skill, record });

    expect(readFileSync(store.paths.state, 'utf8')).toBe(contents);
  });

  it('drops a hand-written duplicate of the same record in one call', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ skills: { triage: { clones: [{ path: '/a' }, { path: '/a' }] } } }));
    manager.forgetClone({ skill: 'triage', record: { path: '/a' } });

    expect(manager.getRegistry().skills).toEqual({ triage: { clones: [] } });
  });
});

describe('trashSkill', () => {
  const at = new Date(2026, 8, 15, 12, 45, 30);
  const stamp = 'triage-20260915T124530';

  it('moves the store copy into <bin>/store and returns the bin', async () => {
    const { manager, store } = await newManager();

    writeSkillDirectory(join(store.paths.skills, 'triage'), { 'SKILL.md': '# triage\n' });

    const bin = manager.trashSkill({ name: 'triage', at });

    expect(bin).toBe(join(store.paths.trash, stamp));
    expect(readFileSync(join(bin, 'store', 'SKILL.md'), 'utf8')).toBe('# triage\n');
    expect(existsSync(join(store.paths.skills, 'triage'))).toBe(false);
    expect(readdirSync(bin)).toEqual(['store']);
  });

  it('takes the next free suffix when the bin already exists', async () => {
    const { manager, store } = await newManager();

    writeSkillDirectory(join(store.paths.skills, 'triage'));
    const first = manager.trashSkill({ name: 'triage', at });

    writeSkillDirectory(join(store.paths.skills, 'triage'));
    const second = manager.trashSkill({ name: 'triage', at });

    expect(second).toBe(`${first}-2`);
  });

  it('refuses a skill the store does not hold, leaving no bin behind', async () => {
    const { manager, store } = await newManager();

    expect(() => manager.trashSkill({ name: 'triage', at })).toThrow(EntityNotFoundError);
    expect(readdirSync(store.paths.trash)).toEqual([]);
  });
});

describe('emptyTrash', () => {
  it('deletes every bin and returns their paths in name order', async () => {
    const { manager, store } = await newManager();
    const triageBinPath = join(store.paths.trash, 'triage-20260915T124530');
    const deployBinPath = join(store.paths.trash, 'deploy-20260920T091502');

    writeSkillDirectory(join(triageBinPath, 'store'));
    writeSkillDirectory(join(deployBinPath, 'store'));

    expect(manager.emptyTrash()).toEqual([deployBinPath, triageBinPath]);
    expect(readdirSync(store.paths.trash)).toEqual([]);
  });

  it('returns nothing for an empty trash', async () => {
    const { manager } = await newManager();

    expect(manager.emptyTrash()).toEqual([]);
  });

  it('leaves .trash/ in place', async () => {
    const { manager, store } = await newManager();

    writeSkillDirectory(join(store.paths.trash, 'triage-20260915T124530', 'store'));

    manager.emptyTrash();

    expect(existsSync(store.paths.trash)).toBe(true);
  });

  it('deletes an entry that is not a bin', async () => {
    const { manager, store } = await newManager();
    const strayPath = join(store.paths.trash, 'notes.txt');

    mkdirSync(store.paths.trash, { recursive: true });
    writeFileSync(strayPath, 'notes\n', 'utf8');

    expect(manager.emptyTrash()).toEqual([strayPath]);
    expect(existsSync(strayPath)).toBe(false);
  });

  it('removes a symlink inside a bin without touching what it points at', async () => {
    const { manager, store, root } = await newManager();
    const outsidePath = join(root, 'outside');
    const outsideFilePath = join(outsidePath, 'keep.md');
    const binPath = join(store.paths.trash, 'triage-20260915T124530');

    mkdirSync(outsidePath);
    writeFileSync(outsideFilePath, 'keep\n', 'utf8');
    writeSkillDirectory(join(binPath, 'store'));
    symlinkSync(outsidePath, join(binPath, 'store', 'linked'));

    manager.emptyTrash();

    expect(existsSync(outsideFilePath)).toBe(true);
    expect(existsSync(binPath)).toBe(false);
  });

  it('leaves the store skills and state.json untouched', async () => {
    const { manager, store, root } = await newManager();
    const skillPath = writeSkillDirectory(join(store.paths.skills, 'triage'));

    manager.registerWorkspace({ name: 'personal', path: join(root, 'project') });
    writeSkillDirectory(join(store.paths.trash, 'deploy-20260920T091502', 'store'));

    const stateBefore = readFileSync(store.paths.state, 'utf8');

    manager.emptyTrash();

    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(store.paths.state, 'utf8')).toBe(stateBefore);
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

describe('skillsDirectory and statePath', () => {
  it("answer the store's own paths, creating nothing", async () => {
    const { manager, store } = await newManager();

    expect(manager.skillsDirectory()).toBe(store.paths.skills);
    expect(manager.statePath()).toBe(store.paths.state);
    expect(existsSync(store.paths.root)).toBe(false);
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

describe('listStrayEntryNames', () => {
  it('returns nothing for a store never written to', async () => {
    const { manager } = await newManager();

    expect(manager.listStrayEntryNames()).toEqual([]);
  });

  it('reports a file, a directory without a manifest, and a directory whose manifest is a directory', async () => {
    const { manager, store } = await newManager();

    mkdirSync(join(store.paths.skills, 'drafts'), { recursive: true });
    mkdirSync(join(store.paths.skills, 'hollow', 'SKILL.md'), { recursive: true });
    writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

    expect(manager.listStrayEntryNames()).toEqual(['drafts', 'hollow', 'notes.txt']);
  });

  it('leaves out skill directories, including a symlink to one outside the store', async () => {
    const { manager, store, root } = await newManager();
    const outsideSkill = writeSkillDirectory(join(root, 'dev', 'outside'));

    writeSkillDirectory(join(store.paths.skills, 'triage'));
    symlinkSync(outsideSkill, join(store.paths.skills, 'linked'));

    expect(manager.listStrayEntryNames()).toEqual([]);
  });

  it('reports a dangling symlink', async () => {
    const { manager, store, root } = await newManager();

    mkdirSync(store.paths.skills, { recursive: true });
    symlinkSync(join(root, 'nowhere'), join(store.paths.skills, 'dangling'));

    expect(manager.listStrayEntryNames()).toEqual(['dangling']);
  });

  it('hides .DS_Store under the default ignore', async () => {
    const { manager, store } = await newManager();

    mkdirSync(store.paths.skills, { recursive: true });
    writeFileSync(join(store.paths.skills, '.DS_Store'), '', 'utf8');

    expect(manager.listStrayEntryNames()).toEqual([]);
  });

  it('reports .git under the default ignore, since dot entries have no exemption', async () => {
    const { manager, store } = await newManager();

    mkdirSync(join(store.paths.skills, '.git'), { recursive: true });

    expect(manager.listStrayEntryNames()).toEqual(['.git']);
  });

  it('honors custom ignore globs', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ ignore: ['*.txt', '.git'] }));
    mkdirSync(join(store.paths.skills, '.git'), { recursive: true });
    mkdirSync(join(store.paths.skills, 'drafts'), { recursive: true });
    writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

    expect(manager.listStrayEntryNames()).toEqual(['drafts']);
  });

  it('reports .DS_Store once an empty ignore list replaces the default', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ ignore: [] }));
    mkdirSync(store.paths.skills, { recursive: true });
    writeFileSync(join(store.paths.skills, '.DS_Store'), '', 'utf8');

    expect(manager.listStrayEntryNames()).toEqual(['.DS_Store']);
  });

  it('does not hide dot entries with an ignore of *, since * does not match a leading dot', async () => {
    const { manager, store } = await newManager();

    writeState(store, document({ ignore: ['*'] }));
    mkdirSync(join(store.paths.skills, '.git'), { recursive: true });
    writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

    expect(manager.listStrayEntryNames()).toEqual(['.git']);
  });

  it('returns names sorted', async () => {
    const { manager, store } = await newManager();

    mkdirSync(store.paths.skills, { recursive: true });

    for (const name of ['zebra.txt', 'alpha.txt', 'mid.txt']) {
      writeFileSync(join(store.paths.skills, name), '', 'utf8');
    }

    expect(manager.listStrayEntryNames()).toEqual(['alpha.txt', 'mid.txt', 'zebra.txt']);
  });
});

describe('store entries that loop or cannot be read', () => {
  it('leaves a self-referencing symlink out of the skills and reports it as stray', async () => {
    const { manager, store } = await newManager();
    const loop = join(store.paths.skills, 'loop');

    writeSkillDirectory(join(store.paths.skills, 'triage'));
    symlinkSync(loop, loop);

    expect(manager.listSkillNames()).toEqual(['triage']);
    expect(manager.listStrayEntryNames()).toEqual(['loop']);
  });

  describe.skipIf(runsAsRoot)('a skill directory with no permissions', () => {
    it('is left out of the skills and reported as stray', async () => {
      const { manager, store } = await newManager();

      writeSkillDirectory(join(store.paths.skills, 'triage'));
      lockDirectory({ path: writeSkillDirectory(join(store.paths.skills, 'locked')) });

      expect(manager.listSkillNames()).toEqual(['triage']);
      expect(manager.listStrayEntryNames()).toEqual(['locked']);
    });
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

/** A manager whose state.json holds exactly `document(sections)`, returned with that text. */
async function seededStore(sections: DocumentSections) {
  const { manager, store } = await newManager();
  const contents = document(sections);

  writeState(store, contents);

  return { manager, store, contents };
}

/** Puts a skill in the store and symlinks it into the workspace, the way `link` does. */
function linkSkill(params: { store: GrimoireStore; workspace: string; skill: string }): void {
  const { store, workspace, skill } = params;
  const target = join(store.paths.skills, skill);

  mkdirSync(target, { recursive: true });
  symlinkSync(target, join(workspace, skill));
}

type DocumentSections = {
  workspaces?: unknown;
  repos?: unknown;
  skills?: unknown;
  ignore?: unknown;
};

/** A whole state.json, as text, carrying only the sections a test cares about. */
function document(sections: DocumentSections): string {
  return JSON.stringify({ workspaces: {}, repos: {}, skills: {}, ignore: ['.DS_Store'], ...sections });
}

/** A state.json where workspace `dotfiles` sits inside repo `library`, both under `root`. */
function overlappingDocument(root: string): string {
  return document({
    workspaces: { dotfiles: { path: join(root, 'dotfiles', 'skills'), autoLink: false } },
    repos: { library: { path: join(root, 'dotfiles') } },
  });
}

/** Registers a repo two levels into a fresh work tree, so its parent holds nothing else, and returns its path. */
async function registerNestedRepo(params: {
  manager: GrimoireStoreManager;
  name: string;
}): Promise<string> {
  const workTree = await tempGitRepo();
  const path = join(workTree.path, 'packages', 'core');

  mkdirSync(path, { recursive: true });
  params.manager.registerRepo({ name: params.name, path });

  return path;
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

/** The error a call throws, which fails the test when it throws nothing. */
function refusalOf(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }

  expect.fail('expected a refusal');
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
