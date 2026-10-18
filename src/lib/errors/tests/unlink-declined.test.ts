import { describe, expect, it } from 'vitest';
import { GrimoireError, UnlinkDeclinedError, describeUnlinkRefusal } from '@/lib/errors';
import type { UnlinkRefusal } from '@/lib/errors';

const refusal = (reason: UnlinkRefusal['reason']): UnlinkRefusal => ({
  skill: 'brainstorm',
  workspace: 'personal',
  path: '/ws/personal/brainstorm',
  reason,
});

describe('describeUnlinkRefusal', () => {
  it('describes a directory occupant', () => {
    expect(describeUnlinkRefusal(refusal('directory'))).toBe(
      'could not unlink brainstorm → personal: /ws/personal/brainstorm is a directory, not a link',
    );
  });

  it('describes a non-link occupant', () => {
    expect(describeUnlinkRefusal(refusal('not-a-link'))).toBe(
      'could not unlink brainstorm → personal: /ws/personal/brainstorm is not a link',
    );
  });

  it('describes a foreign-symlink occupant', () => {
    expect(describeUnlinkRefusal(refusal('foreign-symlink'))).toBe(
      'could not unlink brainstorm → personal: /ws/personal/brainstorm is a symlink pointing elsewhere',
    );
  });

  it('describes a workspace that does not resolve', () => {
    expect(describeUnlinkRefusal(refusal('workspace-unreachable'))).toBe(
      'could not unlink brainstorm → personal: /ws/personal/brainstorm workspace path does not resolve',
    );
  });

  it('describes a workspace that cannot be read', () => {
    expect(describeUnlinkRefusal(refusal('workspace-unreadable'))).toBe(
      'could not unlink brainstorm → personal: /ws/personal/brainstorm workspace path cannot be read',
    );
  });
});

describe('UnlinkDeclinedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new UnlinkDeclinedError({ refusals: [refusal('directory')] });

    expect(error).toBeInstanceOf(GrimoireError);
  });

  it('reports a single refusal as its bare sentence', () => {
    const error = new UnlinkDeclinedError({ refusals: [refusal('directory')] });

    expect(error.message).toBe(describeUnlinkRefusal(refusal('directory')));
  });

  it('aggregates several refusals under a shared header, each indented', () => {
    const refusals = [refusal('directory'), refusal('foreign-symlink')];
    const error = new UnlinkDeclinedError({ refusals });

    expect(error.message).toBe(
      [
        'nothing unlinked:',
        `  ${describeUnlinkRefusal(refusals[0]!)}`,
        `  ${describeUnlinkRefusal(refusals[1]!)}`,
      ].join('\n'),
    );
  });

  it('carries the refusals it was constructed with', () => {
    const refusals = [refusal('directory'), refusal('not-a-link')];
    const error = new UnlinkDeclinedError({ refusals });

    expect(error.refusals).toBe(refusals);
  });
});
