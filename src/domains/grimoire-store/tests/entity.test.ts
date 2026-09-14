import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempRoot } from '#test-helpers/temp-root';
import { GrimoireStore } from '../index.ts';

describe('paths', () => {
  it('lays the store out under the home it was given', () => {
    expect(new GrimoireStore('/home/me/.grimoire').paths).toEqual({
      root: '/home/me/.grimoire',
      skills: '/home/me/.grimoire/skills',
      trash: '/home/me/.grimoire/.trash',
      backup: '/home/me/.grimoire/.backup',
      state: '/home/me/.grimoire/state.json',
    });
  });

  it('normalizes the home it was given', () => {
    expect(new GrimoireStore('~/projects/../.grimoire/').paths.root).toBe(join(homedir(), '.grimoire'));
  });
});

describe('findCollisionWith', () => {
  const store = new GrimoireStore('/home/me/.grimoire');

  it('reports a path sitting inside the store', () => {
    expect(store.findCollisionWith('/home/me/.grimoire/skills')).toEqual({
      kind: 'grimoire-home',
      path: '/home/me/.grimoire',
      relation: 'inside',
    });
  });

  it('reports the store root itself', () => {
    expect(store.findCollisionWith('/home/me/.grimoire')?.relation).toBe('equals');
  });

  it('reports a path the store sits inside', () => {
    expect(store.findCollisionWith('/home/me')?.relation).toBe('contains');
  });

  it('answers with nothing when the path is elsewhere', () => {
    expect(store.findCollisionWith('/home/me/projects/app')).toBeNull();
  });

  it('reads a path spelled unnormalized', () => {
    expect(store.findCollisionWith('/home/me/projects/../.grimoire/skills/')?.relation).toBe('inside');
  });

  // A workspace and the store are one `ln -s` apart from being the same
  // directory, and nothing in state.json changes when that link is repointed.
  it('reports a path reaching the store through a symlink', async () => {
    const root = realpathSync(await tempRoot());
    const linked = new GrimoireStore(join(root, '.grimoire'));

    mkdirSync(join(root, '.grimoire', 'skills'), { recursive: true });
    symlinkSync(join(root, '.grimoire'), join(root, 'store-link'));

    expect(linked.findCollisionWith(join(root, 'store-link/skills'))?.relation).toBe('inside');
  });
});
