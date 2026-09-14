import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathCollisionError, describeCollision } from '../index.ts';
import type { Collision } from '#src/domains/grimoire-store/index';

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
});

describe('PathCollisionError', () => {
  it('carries the same normalized paths it printed', () => {
    const error = new PathCollisionError({ path: '~/.grimoire/skills', collision });

    expect(error.path).toBe(join(homedir(), '.grimoire/skills'));
    expect(error.collision.path).toBe(join(homedir(), '.grimoire'));
  });
});
