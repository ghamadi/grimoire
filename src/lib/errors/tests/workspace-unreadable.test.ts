import { describe, expect, it } from 'vitest';
import { GrimoireError, WorkspaceUnreadableError } from '../index.ts';

describe('WorkspaceUnreadableError', () => {
  it('reads as the three lines the docs pin for one workspace', () => {
    const error = new WorkspaceUnreadableError({
      workspaces: [{ name: 'work', path: '/Volumes/ext/skills', access: 'unresolvable' }],
    });

    expect(error.message).toBe(
      [
        'cannot remove a skill while a workspace is unreadable',
        '  work: /Volumes/ext/skills does not resolve',
        '  make it readable, or unregister it with `grimoire workspaces remove work`',
      ].join('\n'),
    );
  });

  it('points an unreadable first workspace at --force', () => {
    const error = new WorkspaceUnreadableError({
      workspaces: [{ name: 'work', path: '/Volumes/ext/skills', access: 'unreadable' }],
    });

    expect(error.message).toBe(
      [
        'cannot remove a skill while a workspace is unreadable',
        '  work: /Volumes/ext/skills cannot be read',
        '  make it readable, or unregister it anyway with `grimoire workspaces remove work --force`',
      ].join('\n'),
    );
  });

  it('names every workspace on its own line and the first in the remedy', () => {
    const error = new WorkspaceUnreadableError({
      workspaces: [
        { name: 'work', path: '/Volumes/ext/skills', access: 'unresolvable' },
        { name: 'old', path: '/gone/skills', access: 'unresolvable' },
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

  it('lists unreadable and unresolvable workspaces side by side, with the remedy following the first', () => {
    const error = new WorkspaceUnreadableError({
      workspaces: [
        { name: 'old', path: '/gone/skills', access: 'unresolvable' },
        { name: 'work', path: '/Volumes/ext/skills', access: 'unreadable' },
      ],
    });

    expect(error.message).toBe(
      [
        'cannot remove a skill while a workspace is unreadable',
        '  old: /gone/skills does not resolve',
        '  work: /Volumes/ext/skills cannot be read',
        '  make it readable, or unregister it with `grimoire workspaces remove old`',
      ].join('\n'),
    );
  });

  it('routes to the exit-1 branch as a GrimoireError carrying its workspaces', () => {
    const workspaces = [{ name: 'work', path: '/Volumes/ext/skills', access: 'unresolvable' as const }];
    const error = new WorkspaceUnreadableError({ workspaces });

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.workspaces).toBe(workspaces);
  });
});
