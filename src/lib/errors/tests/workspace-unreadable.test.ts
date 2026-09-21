import { describe, expect, it } from 'vitest';
import { GrimoireError, WorkspaceUnreadableError } from '../index.ts';

describe('WorkspaceUnreadableError', () => {
  it('reads as the three lines the docs pin for one workspace', () => {
    const error = new WorkspaceUnreadableError({
      workspaces: [{ name: 'work', path: '/Volumes/ext/skills' }],
    });

    expect(error.message).toBe(
      [
        'cannot remove a skill while a workspace is unreadable',
        '  work: /Volumes/ext/skills does not resolve',
        '  make it readable, or unregister it with `grimoire workspaces remove work`',
      ].join('\n'),
    );
  });

  it('names every workspace on its own line and the first in the remedy', () => {
    const error = new WorkspaceUnreadableError({
      workspaces: [
        { name: 'work', path: '/Volumes/ext/skills' },
        { name: 'old', path: '/gone/skills' },
      ],
    });

    expect(error.message).toBe(
      [
        'cannot remove a skill while a workspace is unreadable',
        '  work: /Volumes/ext/skills does not resolve',
        '  old: /gone/skills does not resolve',
        '  make it readable, or unregister it with `grimoire workspaces remove work`',
      ].join('\n'),
    );
  });

  it('routes to the exit-1 branch as a GrimoireError carrying its workspaces', () => {
    const workspaces = [{ name: 'work', path: '/Volumes/ext/skills' }];
    const error = new WorkspaceUnreadableError({ workspaces });

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.workspaces).toBe(workspaces);
  });
});
