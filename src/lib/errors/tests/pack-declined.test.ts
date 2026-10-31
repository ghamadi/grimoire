import { describe, expect, it } from 'vitest';
import { GrimoireError, PackDeclinedError, describePackRefusal } from '@/lib/errors';
import type { PackRefusal } from '@/lib/errors';

const holdsSymlink: PackRefusal = {
  kind: 'holds-symlink',
  skill: 'triage',
  zipPath: '/Users/me/dist/triage.zip',
  entry: 'refs/link',
};

const occupied: PackRefusal = {
  kind: 'occupied',
  skill: 'review',
  zipPath: '/Users/me/dist/review.zip',
};

describe('describePackRefusal', () => {
  it('names the symlink a skill holds', () => {
    expect(describePackRefusal(holdsSymlink)).toBe(
      'could not pack triage → /Users/me/dist/triage.zip: the skill holds the symlink "refs/link"',
    );
  });

  it('says something sits at the zip path', () => {
    expect(describePackRefusal(occupied)).toBe(
      'could not pack review → /Users/me/dist/review.zip: something is already there — delete it to pack again',
    );
  });
});

describe('PackDeclinedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new PackDeclinedError({ refusals: [occupied] });

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.name).toBe('PackDeclinedError');
  });

  it('reports a single refusal as its bare sentence', () => {
    const error = new PackDeclinedError({ refusals: [occupied] });

    expect(error.message).toBe(describePackRefusal(occupied));
  });

  it('aggregates several refusals under a shared header, each indented', () => {
    const error = new PackDeclinedError({ refusals: [holdsSymlink, occupied] });

    expect(error.message).toBe(
      [
        'nothing packed:',
        `  ${describePackRefusal(holdsSymlink)}`,
        `  ${describePackRefusal(occupied)}`,
      ].join('\n'),
    );
  });

  it('carries the refusals it was constructed with', () => {
    const refusals = [holdsSymlink, occupied];
    const error = new PackDeclinedError({ refusals });

    expect(error.refusals).toBe(refusals);
  });
});
