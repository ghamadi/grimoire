import { describe, expect, it } from 'vitest';
import { AddDeclinedError, GrimoireError, describeAddRefusal } from '@/lib/errors/index';
import type { AddRefusal } from '@/lib/errors/index';

const differs: AddRefusal = {
  kind: 'differs',
  skill: 'deploy',
  storePath: '/store/skills/deploy',
  entry: 'SKILL.md',
};

const unportable: AddRefusal = {
  kind: 'unportable',
  skill: 'scratch',
  sourcePath: '/Users/me/dev/scratch',
  reason: 'nested-skill',
};

const incomparable: AddRefusal = {
  kind: 'incomparable',
  skill: 'notes',
  root: '/Users/me/dev/notes',
  entry: 'ref',
};

describe('describeAddRefusal', () => {
  it('describes a store copy that differs', () => {
    expect(describeAddRefusal(differs)).toBe(
      'could not add deploy: the store holds a different deploy, differing at "SKILL.md" — edit the store copy, or run `grimoire skills remove deploy` first',
    );
  });

  it('describes an unportable source', () => {
    expect(describeAddRefusal(unportable)).toBe(
      'could not add scratch: skill "/Users/me/dev/scratch" is not portable. Contains a nested skill.',
    );
  });

  it('describes a symlink that cannot be compared', () => {
    expect(describeAddRefusal(incomparable)).toBe(
      'could not add notes: /Users/me/dev/notes holds the symlink "ref", so the two copies cannot be compared',
    );
  });
});

describe('AddDeclinedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new AddDeclinedError({ refusals: [differs] });

    expect(error).toBeInstanceOf(GrimoireError);
  });

  it('reports a single refusal as its bare sentence', () => {
    const error = new AddDeclinedError({ refusals: [differs] });

    expect(error.message).toBe(describeAddRefusal(differs));
  });

  it('aggregates several refusals under a shared header, each indented', () => {
    const refusals = [differs, unportable];
    const error = new AddDeclinedError({ refusals });

    expect(error.message).toBe(
      [
        'nothing added:',
        `  ${describeAddRefusal(refusals[0]!)}`,
        `  ${describeAddRefusal(refusals[1]!)}`,
      ].join('\n'),
    );
  });

  it('carries the refusals it was constructed with', () => {
    const refusals = [differs, incomparable];
    const error = new AddDeclinedError({ refusals });

    expect(error.refusals).toBe(refusals);
  });
});
