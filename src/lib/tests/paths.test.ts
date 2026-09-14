import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePath, relate } from '../paths.ts';
import { tempRoot } from '#test-helpers/temp-root';

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

/**
 * A temp root with its own symlinks resolved away, so a test asserting on a
 * resolved path is not really asserting that macOS keeps `/var` a symlink to
 * `/private/var`.
 */
async function realRoot(): Promise<string> {
  return realpathSync(await tempRoot());
}
