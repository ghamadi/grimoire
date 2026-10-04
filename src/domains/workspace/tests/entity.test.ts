import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidWorkspaceNameError } from '#src/lib/errors/index';
import { Workspace } from '#src/domains/workspace/index';

describe('Workspace.isValidName', () => {
  it.each(['personal', 'Work2', '9lives', 'my-project', 'my_project', 'a'])('accepts %j', (name) => {
    expect(Workspace.isValidName(name)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['holding a separator', 'a/b'],
    ['holding a backslash', 'a\\b'],
    ['a bare tilde', '~'],
    ['a home-relative path', '~/skills'],
    ['the current directory', '.'],
    ['the parent directory', '..'],
    ['holding a dot', 'my.project'],
    ['holding a space', 'my project'],
    ['with a trailing newline', 'personal\n'],
    ['holding a shell metacharacter', 'a$b'],
    ['holding a non-ASCII letter', 'café'],
    ['starting with "-", which commander reads as an option', '-personal'],
    ['starting with "_"', '_personal'],
  ])('refuses a name %s', (_, name) => {
    expect(Workspace.isValidName(name)).toBe(false);
  });
});

describe('new Workspace', () => {
  it('holds a valid name', () => {
    const workspace = new Workspace({ name: 'personal', path: '/skills', autoLink: false });

    expect(workspace.name).toBe('personal');
  });

  it('refuses an invalid name, naming it on the error', () => {
    const error = captureError(() => new Workspace({ name: 'a/b', path: '/skills', autoLink: false }));

    expect(error).toBeInstanceOf(InvalidWorkspaceNameError);
    expect(error.name).toBe('InvalidWorkspaceNameError');
    expect((error as InvalidWorkspaceNameError).entryName).toBe('a/b');
  });
});

describe('Workspace.stagingDirectory', () => {
  it('sits directly inside the workspace path', () => {
    const path = '/Users/me/work/.agents/skills';
    const workspace = new Workspace({ name: 'work', path, autoLink: false });

    expect(workspace.stagingDirectory).toBe(join(path, '.grimoire-staging'));
  });
});

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a throw');
}
