import { describe, expect, it } from 'vitest';
import { GrimoireError, PackFailedError, describePackFailure } from '@/lib/errors';
import type { PackFailure } from '@/lib/errors';

const denied: PackFailure = {
  skill: 'triage',
  zipPath: '/Users/me/dist/triage.zip',
  error: new Error("EACCES: permission denied, open '/a'"),
};

const unusableStaging: PackFailure = {
  skill: 'review',
  zipPath: '/Users/me/dist/review.zip',
  error: new Error('/Users/me/dist/.grimoire-staging is not a directory'),
};

describe('describePackFailure', () => {
  it('describes a failed skill by its error message', () => {
    expect(describePackFailure(denied)).toBe(
      "failed to pack triage → /Users/me/dist/triage.zip: EACCES: permission denied, open '/a'",
    );
  });
});

describe('PackFailedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new PackFailedError({ failures: [denied] });

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.name).toBe('PackFailedError');
  });

  it('reports a single failure as its bare sentence', () => {
    const error = new PackFailedError({ failures: [denied] });

    expect(error.message).toBe(describePackFailure(denied));
  });

  it('aggregates several failures under a shared header, each indented', () => {
    const error = new PackFailedError({ failures: [unusableStaging, denied] });

    expect(error.message).toBe(
      [
        'packs failed:',
        `  ${describePackFailure(unusableStaging)}`,
        `  ${describePackFailure(denied)}`,
      ].join('\n'),
    );
  });

  it('carries the failures it was constructed with', () => {
    const failures = [denied, unusableStaging];
    const error = new PackFailedError({ failures });

    expect(error.failures).toBe(failures);
  });
});
