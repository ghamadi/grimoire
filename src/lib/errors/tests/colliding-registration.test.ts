import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CollidingRegistrationError } from '@/lib/errors';

describe('CollidingRegistrationError', () => {
  it('tells the user to remove the entry when it touches the store', () => {
    const error = new CollidingRegistrationError({
      entity: 'workspace',
      name: 'bad',
      path: '/x/.grimoire/skills',
      collision: { kind: 'grimoire-home', path: '/x/.grimoire', relation: 'inside' },
      storeState: '/x/.grimoire/state.json',
    });

    expect(error.message).toBe(
      [
        'workspace "bad" cannot be used: /x/.grimoire/skills sits inside the grimoire store (/x/.grimoire)',
        '  no command can run until it is gone from /x/.grimoire/state.json',
      ].join('\n'),
    );
  });

  it('offers removing either entry when a workspace overlaps a repo', () => {
    const error = new CollidingRegistrationError({
      entity: 'workspace',
      name: 'dotfiles',
      path: '/x/dotfiles/skills',
      collision: { kind: 'repo', name: 'library', path: '/x/dotfiles', relation: 'inside' },
      storeState: '/x/.grimoire/state.json',
    });

    expect(error.message).toBe(
      [
        'workspace "dotfiles" cannot be used: /x/dotfiles/skills sits inside repo "library" (/x/dotfiles)',
        '  no command can run until one of them is gone from /x/.grimoire/state.json',
      ].join('\n'),
    );
  });

  it('carries the entry name and the same normalized paths it printed', () => {
    const error = new CollidingRegistrationError({
      entity: 'workspace',
      name: 'dotfiles',
      path: '~/dotfiles/skills',
      collision: { kind: 'repo', name: 'library', path: '~/dotfiles', relation: 'inside' },
      storeState: '~/.grimoire/state.json',
    });

    expect(error.entryName).toBe('dotfiles');
    expect(error.path).toBe(join(homedir(), 'dotfiles/skills'));
    expect(error.collision).toEqual({
      kind: 'repo',
      name: 'library',
      path: join(homedir(), 'dotfiles'),
      relation: 'inside',
    });
  });
});
