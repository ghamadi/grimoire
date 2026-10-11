import { describe, expect, it } from 'vitest';
import { CloneFailedError, GrimoireError, describeCloneFailure } from '@/lib/errors/index';
import type { CloneFailure } from '@/lib/errors/index';

const dest = '/Users/me/work/.agents/skills/triage';

const denied: CloneFailure = {
  skill: 'triage',
  workspace: 'work',
  path: dest,
  error: new Error("EACCES: permission denied, rename '/a' -> '/b'"),
};

const unusableStaging: CloneFailure = {
  skill: 'triage',
  workspace: 'personal',
  path: '/Users/me/.claude/skills/triage',
  error: new Error('/Users/me/.claude/skills/.grimoire-staging is not a directory'),
};

describe('describeCloneFailure', () => {
  it('describes a failed pair by its error message', () => {
    expect(describeCloneFailure(denied)).toBe(
      "failed to clone triage → work: EACCES: permission denied, rename '/a' -> '/b'",
    );
  });
});

describe('CloneFailedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new CloneFailedError({ failures: [denied] });

    expect(error).toBeInstanceOf(GrimoireError);
  });

  it('reports a single failure as its bare sentence', () => {
    const error = new CloneFailedError({ failures: [denied] });

    expect(error.message).toBe(describeCloneFailure(denied));
  });

  it('aggregates several failures under a shared header, each indented', () => {
    const error = new CloneFailedError({ failures: [unusableStaging, denied] });

    expect(error.message).toBe(
      [
        'clones failed:',
        `  ${describeCloneFailure(unusableStaging)}`,
        `  ${describeCloneFailure(denied)}`,
      ].join('\n'),
    );
  });

  it('carries the failures it was constructed with', () => {
    const failures = [denied, unusableStaging];
    const error = new CloneFailedError({ failures });

    expect(error.failures).toBe(failures);
  });
});
