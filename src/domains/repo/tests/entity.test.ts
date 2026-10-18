import { describe, expect, it } from 'vitest';
import { InvalidNameError } from '@/lib/errors';
import { Repo } from '@/domains/repo';
import { Workspace } from '@/domains/workspace';

const NAMES = [
  'personal',
  'Work2',
  '9lives',
  'my-project',
  'my_project',
  'a',
  '',
  'a/b',
  'a\\b',
  '~',
  '~/skills',
  '.',
  '..',
  'my.project',
  'my project',
  'personal\n',
  'a$b',
  'café',
  '-personal',
  '_personal',
];

describe('Repo.isValidName', () => {
  it.each(NAMES)('agrees with Workspace.isValidName on %j', (name) => {
    expect(Repo.isValidName(name)).toBe(Workspace.isValidName(name));
  });

  it.each(['library', 'my-project', '9lives'])('accepts %j', (name) => {
    expect(Repo.isValidName(name)).toBe(true);
  });

  it.each(['', 'a/b', 'my.project', '-library'])('refuses %j', (name) => {
    expect(Repo.isValidName(name)).toBe(false);
  });
});

describe('new Repo', () => {
  it('holds a valid name and its path', () => {
    const repo = new Repo({ name: 'library', path: '/work/library' });

    expect(repo.name).toBe('library');
    expect(repo.path).toBe('/work/library');
  });

  it('refuses an invalid name, naming it on the error', () => {
    const error = captureError(() => new Repo({ name: 'a/b', path: '/work/library' }));

    expect(error).toBeInstanceOf(InvalidNameError);
    expect(error.name).toBe('InvalidNameError');
    expect((error as InvalidNameError).entity).toBe('repo');
    expect((error as InvalidNameError).entryName).toBe('a/b');
    expect(error.message).toBe(
      'repo name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"',
    );
  });
});

describe('Repo.stagingDirectory', () => {
  it('is .grimoire-staging inside the repo path', () => {
    const repo = new Repo({ name: 'library', path: '/Users/me/library' });

    expect(repo.stagingDirectory).toBe('/Users/me/library/.grimoire-staging');
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
