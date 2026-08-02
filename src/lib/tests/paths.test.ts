import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findGrimoireHomeCollision,
  findRepoCollision,
  findWorkspaceCollision,
  normalizePath,
  relate,
} from '../paths.ts';
import type { Config } from '#src/store/index';
import { tempRoot } from '#test-helpers/temp-root';

const home = '/home/me/.grimoire';

describe('normalizePath', () => {
  it('expands a leading ~', () => {
    expect(normalizePath('~/repos/skills')).toBe(join(homedir(), 'repos/skills'));
  });

  it('expands a bare ~', () => {
    expect(normalizePath('~')).toBe(homedir());
  });

  // A `~` that is part of a name is a directory called `~backup`, not a home
  // directory reference.
  it('leaves a ~ that does not start a segment alone', () => {
    expect(normalizePath('/repos/~backup')).toBe('/repos/~backup');
  });

  it('resolves a relative path against the cwd', () => {
    expect(normalizePath('repos/skills')).toBe(resolve(process.cwd(), 'repos/skills'));
  });

  it('collapses .. segments', () => {
    expect(normalizePath('/repos/personal/../team')).toBe('/repos/team');
  });

  it('drops a trailing slash', () => {
    expect(normalizePath('/repos/personal/')).toBe('/repos/personal');
  });

  it('passes an already-canonical path through unchanged', () => {
    expect(normalizePath('/repos/personal')).toBe('/repos/personal');
  });
});

describe('relate', () => {
  it('reports equal paths', () => {
    expect(relate({ candidate: '/repos/bar', reference: '/repos/bar' })).toBe('equals');
  });

  it('reports a candidate sitting inside the reference', () => {
    expect(relate({ candidate: '/repos/bar/skills', reference: '/repos/bar' })).toBe('inside');
  });

  it('reports a candidate containing the reference', () => {
    expect(relate({ candidate: '/repos', reference: '/repos/bar' })).toBe('contains');
  });

  it('reports nothing for unrelated paths', () => {
    expect(relate({ candidate: '/repos/bar', reference: '/projects/app' })).toBeNull();
  });

  // The precondition callers used to carry: a trailing separator alone would
  // otherwise read as unrelated.
  it('normalizes both sides before comparing', () => {
    expect(relate({ candidate: '/repos/bar/', reference: '/repos/bar' })).toBe('equals');
    expect(relate({ candidate: '/repos/team/../bar/skills', reference: '/repos/bar' })).toBe('inside');
  });

  // The case a naive prefix test gets wrong: a shared prefix is not containment
  // unless it ends at a separator.
  it('does not mistake a shared name prefix for containment', () => {
    expect(relate({ candidate: '/repos/barbaz', reference: '/repos/bar' })).toBeNull();
    expect(relate({ candidate: '/repos/bar', reference: '/repos/barbaz' })).toBeNull();
  });

  // The dotfiles layout: the two share no lexical prefix at all.
  it('follows a symlink standing in the path', async () => {
    const root = await realRoot();
    const real = join(root, 'dotfiles/claude/skills');

    mkdirSync(real, { recursive: true });
    symlinkSync(join(root, 'dotfiles/claude'), join(root, '.claude'));

    expect(relate({ candidate: join(root, '.claude/skills'), reference: real })).toBe('equals');
  });

  it('resolves the existing prefix and keeps the segments below it', async () => {
    const root = await realRoot();

    mkdirSync(join(root, 'repos/skills'), { recursive: true });
    symlinkSync(join(root, 'repos'), join(root, 'link'));

    expect(
      relate({
        candidate: join(root, 'link/skills/vendor/new'),
        reference: join(root, 'repos/skills'),
      }),
    ).toBe('inside');
  });

  it('compares two paths with no existing ancestor lexically', () => {
    expect(relate({ candidate: '/nowhere/at/all', reference: '/nowhere' })).toBe('inside');
  });

  it('normalizes before resolving', async () => {
    const root = await realRoot();

    mkdirSync(join(root, 'repos/skills'), { recursive: true });
    symlinkSync(join(root, 'repos'), join(root, 'link'));

    expect(
      relate({ candidate: join(root, 'link/team/../skills/'), reference: join(root, 'repos/skills') }),
    ).toBe('equals');
  });
});

describe('findGrimoireHomeCollision', () => {
  it('reports a path inside the store', () => {
    expect(findGrimoireHomeCollision({ home, path: `${home}/skills` })).toEqual({
      kind: 'grimoire-home',
      path: home,
      relation: 'inside',
    });
  });

  it('reports the store root itself', () => {
    expect(findGrimoireHomeCollision({ home, path: home })?.relation).toBe('equals');
  });

  it('returns null when the path is elsewhere', () => {
    expect(findGrimoireHomeCollision({ home, path: '/repos/personal' })).toBeNull();
  });

  it('reports a path reaching the store through a symlink', async () => {
    const root = await realRoot();
    const store = join(root, '.grimoire');

    mkdirSync(join(store, 'skills'), { recursive: true });
    symlinkSync(store, join(root, 'store-link'));

    expect(findGrimoireHomeCollision({ home: store, path: join(root, 'store-link/skills') })).toEqual({
      kind: 'grimoire-home',
      path: store,
      relation: 'inside',
    });
  });
});

describe('findWorkspaceCollision', () => {
  it('names the workspace a repo path sits inside', () => {
    const config = configWith({ workspaces: { app: { path: '/projects/app', autoLink: true } } });

    expect(findWorkspaceCollision({ storeConfig: config, path: '/projects/app/skills' })).toEqual({
      kind: 'registered',
      registry: 'workspaces',
      name: 'app',
      path: '/projects/app',
      relation: 'inside',
    });
  });

  it('reports a repo path that would contain a workspace', () => {
    const config = configWith({ workspaces: { app: { path: '/projects/app', autoLink: true } } });

    expect(findWorkspaceCollision({ storeConfig: config, path: '/projects' })?.relation).toBe(
      'contains',
    );
  });

  it('returns null when nothing overlaps', () => {
    const config = configWith({ workspaces: { app: { path: '/projects/app', autoLink: true } } });

    expect(findWorkspaceCollision({ storeConfig: config, path: '/repos/personal' })).toBeNull();
  });

  // config.json is hand-editable, so a registered path is never assumed
  // canonical — the rule is applied wherever a path is used, never inferred
  // from registration.
  it('collides with a registered path stored un-normalized', () => {
    const config = configWith({
      workspaces: { app: { path: '/projects/other/../app/', autoLink: true } },
    });

    expect(findWorkspaceCollision({ storeConfig: config, path: '/projects/app/skills' })).toMatchObject({
      name: 'app',
      relation: 'inside',
    });
  });

  it('reports the registered path in the spelling it was given', () => {
    const config = configWith({ workspaces: { app: { path: '/projects/app', autoLink: true } } });

    expect(findWorkspaceCollision({ storeConfig: config, path: '/projects/app/skills' })?.path).toBe(
      '/projects/app',
    );
  });

  // The dotfiles layout: `~/.claude` is a symlink into the repo the workspace
  // is registered under, so one directory has two spellings that share no
  // lexical prefix. Missing this is what lets `import --all` auto-link a repo's
  // own skills into symlinks.
  it('collides with a workspace reached by a symlinked spelling', async () => {
    const root = await realRoot();
    const real = join(root, 'dotfiles/claude/skills');
    const registered = join(root, '.claude/skills');

    mkdirSync(real, { recursive: true });
    symlinkSync(join(root, 'dotfiles/claude'), join(root, '.claude'));

    const config = configWith({ workspaces: { personal: { path: registered, autoLink: true } } });

    expect(findWorkspaceCollision({ storeConfig: config, path: real })).toEqual({
      kind: 'registered',
      registry: 'workspaces',
      name: 'personal',
      path: registered,
      relation: 'equals',
    });
  });

  // The wrappers are not symmetric: two repos overlapping is not this rule's
  // business, only a repo overlapping the *other* registry is.
  it('ignores an overlap with another repo', () => {
    const config = configWith({ repos: { team: { path: '/repos/team', mode: 'read-only' } } });

    expect(findWorkspaceCollision({ storeConfig: config, path: '/repos/team/skills' })).toBeNull();
  });
});

describe('findRepoCollision', () => {
  it('names the repo a workspace path sits inside', () => {
    const config = configWith({ repos: { team: { path: '/repos/team', mode: 'read-only' } } });

    expect(findRepoCollision({ storeConfig: config, path: '/repos/team/skills' })).toEqual({
      kind: 'registered',
      registry: 'repos',
      name: 'team',
      path: '/repos/team',
      relation: 'inside',
    });
  });

  it('ignores an overlap with another workspace', () => {
    const config = configWith({ workspaces: { app: { path: '/projects/app', autoLink: true } } });

    expect(findRepoCollision({ storeConfig: config, path: '/projects/app/skills' })).toBeNull();
  });
});

function configWith(partial: Partial<Config>): Config {
  return { repos: {}, workspaces: {}, ignore: [], ...partial };
}

/**
 * A temp root with its own symlinks resolved away, so a test asserting on a
 * resolved path is not really asserting that macOS keeps `/var` a symlink to
 * `/private/var`.
 */
async function realRoot(): Promise<string> {
  return realpathSync(await tempRoot());
}
