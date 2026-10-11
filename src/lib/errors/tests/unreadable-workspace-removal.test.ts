import { describe, expect, it } from 'vitest';
import { GrimoireError, UnreadableWorkspaceRemovalError } from '@/lib/errors/index';

describe('UnreadableWorkspaceRemovalError', () => {
  it('suggests the bare --force command when the refused run was not hard', () => {
    const error = new UnreadableWorkspaceRemovalError({
      name: 'work',
      path: '/Volumes/ext/skills',
      hard: false,
    });

    expect(error.message).toBe(
      [
        'cannot remove workspace "work": /Volumes/ext/skills cannot be read',
        '  make it readable, then run this again, or unregister it anyway with `grimoire workspaces remove work --force`',
      ].join('\n'),
    );
  });

  it('repeats --hard in the suggested command when the refused run had it', () => {
    const error = new UnreadableWorkspaceRemovalError({
      name: 'work',
      path: '/Volumes/ext/skills',
      hard: true,
    });

    expect(error.message).toBe(
      [
        'cannot remove workspace "work": /Volumes/ext/skills cannot be read',
        '  make it readable, then run this again, or unregister it anyway with `grimoire workspaces remove work --hard --force`',
      ].join('\n'),
    );
  });

  it('routes to the exit-1 branch as a GrimoireError carrying its props', () => {
    const error = new UnreadableWorkspaceRemovalError({ name: 'work', path: '/x', hard: true });

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.entryName).toBe('work');
    expect(error.path).toBe('/x');
    expect(error.hard).toBe(true);
  });
});
