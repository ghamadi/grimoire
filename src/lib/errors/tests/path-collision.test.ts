import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathCollisionError, describeCollision } from '../index.ts';
import type { Collision } from '#src/lib/paths';

const collision: Collision = {
  kind: 'registered',
  registry: 'repos',
  name: 'dots',
  path: '~/repos/dots',
  relation: 'contains',
};

describe('describeCollision', () => {
  it('normalizes both paths in the sentence', () => {
    expect(describeCollision({ path: '~/repos/dots/skills', collision })).toBe(
      `${join(homedir(), 'repos/dots/skills')} contains repo "dots" (${join(homedir(), 'repos/dots')})`,
    );
  });

  it('names the grimoire store rather than a registry entry', () => {
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
    const error = new PathCollisionError({ path: '~/repos/dots/skills', collision });

    expect(error.path).toBe(join(homedir(), 'repos/dots/skills'));
    expect(error.collision.path).toBe(join(homedir(), 'repos/dots'));
  });
});
