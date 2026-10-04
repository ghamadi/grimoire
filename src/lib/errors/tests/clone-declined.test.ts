import { describe, expect, it } from 'vitest';
import { CloneDeclinedError, GrimoireError, describeCloneRefusal } from '../index.ts';
import type { CloneOccupant, CloneRefusal } from '../index.ts';

const skill = 'triage';
const workspace = 'work';
const workspacePath = '/Users/me/work/.agents/skills';
const dest = '/Users/me/work/.agents/skills/triage';

const unreachable: CloneRefusal = {
  kind: 'workspace-unreachable',
  skill,
  workspace,
  path: workspacePath,
};

const unreadable: CloneRefusal = {
  kind: 'workspace-unreadable',
  skill,
  workspace,
  path: workspacePath,
};

const occupied = (occupant: CloneOccupant): CloneRefusal => ({
  kind: 'occupied',
  skill,
  workspace,
  path: dest,
  occupant,
});

describe('describeCloneRefusal', () => {
  it('describes a workspace that does not resolve', () => {
    expect(describeCloneRefusal(unreachable)).toBe(
      'could not clone triage → work: /Users/me/work/.agents/skills is not an existing directory',
    );
  });

  it('describes a workspace that cannot be read', () => {
    expect(describeCloneRefusal(unreadable)).toBe(
      'could not clone triage → work: /Users/me/work/.agents/skills cannot be read',
    );
  });

  it('describes a not-a-skill occupant', () => {
    expect(describeCloneRefusal(occupied({ kind: 'not-a-skill' }))).toBe(
      'could not clone triage → work: /Users/me/work/.agents/skills/triage is a directory with no SKILL.md',
    );
  });

  it('describes a not-a-directory occupant', () => {
    expect(describeCloneRefusal(occupied({ kind: 'not-a-directory' }))).toBe(
      'could not clone triage → work: /Users/me/work/.agents/skills/triage is not a directory',
    );
  });

  it('describes a foreign-symlink occupant', () => {
    expect(describeCloneRefusal(occupied({ kind: 'foreign-symlink' }))).toBe(
      'could not clone triage → work: /Users/me/work/.agents/skills/triage is a symlink pointing elsewhere',
    );
  });
});

describe('CloneDeclinedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new CloneDeclinedError({ refusals: [unreachable] });

    expect(error).toBeInstanceOf(GrimoireError);
  });

  it('reports a single refusal as its bare sentence', () => {
    const error = new CloneDeclinedError({ refusals: [unreachable] });

    expect(error.message).toBe(describeCloneRefusal(unreachable));
  });

  it('aggregates several refusals under a shared header, each indented', () => {
    const refusals = [unreachable, occupied({ kind: 'foreign-symlink' })];
    const error = new CloneDeclinedError({ refusals });

    expect(error.message).toBe(
      [
        'nothing cloned:',
        `  ${describeCloneRefusal(refusals[0]!)}`,
        `  ${describeCloneRefusal(refusals[1]!)}`,
      ].join('\n'),
    );
  });

  it('carries the refusals it was constructed with', () => {
    const refusals = [unreachable, occupied({ kind: 'not-a-skill' })];
    const error = new CloneDeclinedError({ refusals });

    expect(error.refusals).toBe(refusals);
  });
});
