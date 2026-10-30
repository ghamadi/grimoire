import { describe, expect, it } from 'vitest';
import { GrimoireError, LinkDeclinedError, describeLinkRefusal } from '@/lib/errors';
import type { LinkRefusal } from '@/lib/errors';

const workspace = 'work';
const workspacePath = '/Users/me/work/.agents/skills';

const unreachable: LinkRefusal = { kind: 'workspace-unreachable', workspace, path: workspacePath };
const unreadable: LinkRefusal = { kind: 'workspace-unreadable', workspace, path: workspacePath };

describe('describeLinkRefusal', () => {
  it('describes a workspace that does not resolve', () => {
    expect(describeLinkRefusal(unreachable)).toBe(
      'workspace "work" was skipped: /Users/me/work/.agents/skills is not an existing directory',
    );
  });

  it('describes a workspace that cannot be read', () => {
    expect(describeLinkRefusal(unreadable)).toBe(
      'workspace "work" was skipped: /Users/me/work/.agents/skills cannot be read',
    );
  });

  it('describes a destination that cannot be read in full', () => {
    expect(
      describeLinkRefusal({
        kind: 'occupied',
        skill: 'triage',
        workspace,
        path: `${workspacePath}/triage`,
        occupant: { kind: 'unreadable-directory', unreadablePath: `${workspacePath}/triage/refs` },
      }),
    ).toBe('could not link triage → work: /Users/me/work/.agents/skills/triage/refs cannot be read');
  });

  it('describes a destination that cannot be written', () => {
    expect(
      describeLinkRefusal({
        kind: 'unwritable',
        skill: 'triage',
        workspace,
        path: `${workspacePath}/triage`,
      }),
    ).toBe('could not link triage → work: /Users/me/work/.agents/skills/triage cannot be written');
  });
});

describe('LinkDeclinedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    expect(new LinkDeclinedError({ refusals: [unreadable] })).toBeInstanceOf(GrimoireError);
  });

  it('reports a single refusal as its bare sentence', () => {
    const error = new LinkDeclinedError({ refusals: [unreadable] });

    expect(error.message).toBe(describeLinkRefusal(unreadable));
  });

  it('aggregates several refusals under a shared header, each indented', () => {
    const error = new LinkDeclinedError({ refusals: [unreachable, unreadable] });

    expect(error.message).toBe(
      [
        'nothing linked:',
        `  ${describeLinkRefusal(unreachable)}`,
        `  ${describeLinkRefusal(unreadable)}`,
      ].join('\n'),
    );
  });
});
