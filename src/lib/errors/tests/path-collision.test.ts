import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathCollisionError, describeCollision } from '@/lib/errors';
import type { Collision } from '@/domains/grimoire-store';

const collision: Collision = {
  kind: 'grimoire-home',
  path: '~/.grimoire',
  relation: 'contains',
};

describe('describeCollision', () => {
  it('normalizes both paths in the sentence', () => {
    expect(describeCollision({ path: '~/.grimoire/skills', collision })).toBe(
      `${join(homedir(), '.grimoire/skills')} contains the grimoire store (${join(homedir(), '.grimoire')})`,
    );
  });

  it('names the relation the path sits in', () => {
    expect(
      describeCollision({
        path: '/x/skills',
        collision: { kind: 'grimoire-home', path: '~/.grimoire', relation: 'inside' },
      }),
    ).toBe(`/x/skills sits inside the grimoire store (${join(homedir(), '.grimoire')})`);
  });

  it('names the repo a path sits inside', () => {
    expect(
      describeCollision({
        path: '/x/dotfiles/skills',
        collision: { kind: 'repo', name: 'library', path: '/x/dotfiles', relation: 'inside' },
      }),
    ).toBe('/x/dotfiles/skills sits inside repo "library" (/x/dotfiles)');
  });

  it('names the workspace a path contains', () => {
    expect(
      describeCollision({
        path: '/x/dotfiles',
        collision: {
          kind: 'workspace',
          name: 'personal',
          path: '/x/dotfiles/skills',
          relation: 'contains',
        },
      }),
    ).toBe('/x/dotfiles contains workspace "personal" (/x/dotfiles/skills)');
  });

  it('normalizes both paths when the collision is with a registered entry', () => {
    expect(
      describeCollision({
        path: '~/dotfiles/skills',
        collision: { kind: 'repo', name: 'library', path: '~/dotfiles', relation: 'inside' },
      }),
    ).toBe(
      `${join(homedir(), 'dotfiles/skills')} sits inside repo "library" (${join(homedir(), 'dotfiles')})`,
    );
  });
});

describe('PathCollisionError', () => {
  it('carries the same normalized paths it printed', () => {
    const error = new PathCollisionError({ path: '~/.grimoire/skills', collision });

    expect(error.path).toBe(join(homedir(), '.grimoire/skills'));
    expect(error.collision.path).toBe(join(homedir(), '.grimoire'));
  });

  it('keeps the name of a registered entry beside its normalized path', () => {
    const error = new PathCollisionError({
      path: '~/dotfiles/skills',
      collision: { kind: 'repo', name: 'library', path: '~/dotfiles', relation: 'inside' },
    });

    expect(error.collision).toEqual({
      kind: 'repo',
      name: 'library',
      path: join(homedir(), 'dotfiles'),
      relation: 'inside',
    });
  });
});
