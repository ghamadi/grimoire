import { existsSync, mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidPathError } from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';
import { toRegisteredPath } from '../helpers/registered-path.ts';

describe('toRegisteredPath', () => {
  it('reports the directory it found, with nothing created', async () => {
    const path = join(await tempRoot(), 'skills');

    mkdirSync(path);

    expect(toRegisteredPath({ path })).toEqual({ path, created: false });
  });

  it('collapses parent segments and trailing separators', async () => {
    const root = await tempRoot();
    const path = join(root, 'skills');

    mkdirSync(path);

    expect(toRegisteredPath({ path: `${root}/other/../skills/` }).path).toBe(path);
  });

  it('refuses a relative path, echoing it as typed', () => {
    const error = refusal(() => toRegisteredPath({ path: 'skills/mine' }));

    expect(error.reason).toBe('not-absolute');
    expect(error.path).toBe('skills/mine');
  });

  it('refuses a symlink rather than following it', async () => {
    const root = await tempRoot();
    const target = join(root, 'target');
    const path = join(root, 'skills');

    mkdirSync(target);
    symlinkSync(target, path);

    expect(refusal(() => toRegisteredPath({ path })).reason).toBe('symlink');
  });

  it('refuses a path held by a file', async () => {
    const path = join(await tempRoot(), 'skills');

    writeFileSync(path, '');

    expect(refusal(() => toRegisteredPath({ path })).reason).toBe('not-a-directory');
  });

  it('refuses a missing path unless asked to create one', async () => {
    const path = join(await tempRoot(), 'skills');

    expect(refusal(() => toRegisteredPath({ path })).reason).toBe('missing');
    expect(existsSync(path)).toBe(false);
  });

  it('creates the final segment and reports it', async () => {
    const path = join(await tempRoot(), 'skills');

    expect(toRegisteredPath({ path, createIfMissing: true })).toEqual({ path, created: true });
    expect(statSync(path).isDirectory()).toBe(true);
  });

  // A typo in the parent should surface as one rather than materialize a tree.
  it('creates one segment only, refusing a missing parent by name', async () => {
    const root = await tempRoot();
    const parent = join(root, 'claude');

    const error = refusal(() =>
      toRegisteredPath({ path: join(parent, 'skills'), createIfMissing: true }),
    );

    expect(error.reason).toBe('missing');
    expect(error.path).toBe(parent);
    expect(existsSync(parent)).toBe(false);
  });

  it('names the parent when it is a file, not the path that could not be created', async () => {
    const parent = join(await tempRoot(), 'notes.txt');

    writeFileSync(parent, '');

    const error = refusal(() =>
      toRegisteredPath({ path: join(parent, 'skills'), createIfMissing: true }),
    );

    expect(error.reason).toBe('not-a-directory');
    expect(error.path).toBe(parent);
  });

  // `stat` reports nothing there, which would leave the creation to fail on the link.
  it('refuses a dangling symlink rather than creating through it', async () => {
    const root = await tempRoot();
    const path = join(root, 'skills');

    symlinkSync(join(root, 'gone'), path);

    expect(refusal(() => toRegisteredPath({ path, createIfMissing: true })).reason).toBe('symlink');
  });
});

function refusal(run: () => unknown): InvalidPathError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidPathError);

    return error as InvalidPathError;
  }

  expect.fail('expected a refusal');
}
