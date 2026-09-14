import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidPathError } from '#src/lib/errors/index';
import { tryStatSync } from '#src/lib/fs';
import { tempRoot } from '#test-helpers/temp-root';

describe('tryStat', () => {
  it('answers with the stats of what sits at the path', async () => {
    const root = await tempRoot();
    const path = join(root, 'skills');

    mkdirSync(path);

    expect(tryStatSync(path)?.isDirectory()).toBe(true);
  });

  it('answers undefined when nothing is at the path', async () => {
    const root = await tempRoot();

    expect(tryStatSync(join(root, 'gone'))).toBeUndefined();
  });

  /**
   * The ENOTDIR case `throwIfNoEntry` turns out to cover as well as ENOENT.
   * It reads as the same nothing to every caller, which is why none of them
   * needs to tell the two apart.
   */
  it('answers undefined for a path buried under a file', async () => {
    const root = await tempRoot();
    const file = join(root, 'notes.txt');

    writeFileSync(file, '', 'utf8');

    expect(tryStatSync(join(file, 'skills'))).toBeUndefined();
  });

  it('follows a symlink to the directory it names', async () => {
    const root = await tempRoot();
    const target = join(root, 'target');
    const link = join(root, 'link');

    mkdirSync(target);
    symlinkSync(target, link);

    expect(tryStatSync(link)?.isDirectory()).toBe(true);
  });

  /**
   * The one unusable path `stat` cannot answer by returning: it follows links,
   * so it raises ELOOP. Left untranslated, the errno escapes as a crash from
   * whichever command happened to touch the path.
   */
  describe('a path that cannot be resolved', () => {
    it('refuses a cycle between two symlinks', async () => {
      const root = await tempRoot();
      const first = join(root, 'a');

      symlinkSync(join(root, 'b'), first);
      symlinkSync(first, join(root, 'b'));

      const error = refusal(() => tryStatSync(first));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect((error as InvalidPathError).reason).toBe('unresolvable');
    });

    it('refuses a symlink pointing at itself', async () => {
      const root = await tempRoot();
      const path = join(root, 'self');

      symlinkSync(path, path);

      expect((refusal(() => tryStatSync(path)) as InvalidPathError).reason).toBe('unresolvable');
    });

    // Not a cycle at all: the kernel gives up after a fixed number of hops, so
    // depth alone reaches the same refusal.
    it('refuses a chain longer than the kernel will follow', async () => {
      const root = await tempRoot();
      let previous = join(root, 'end');

      mkdirSync(previous);

      for (let hop = 0; hop < 60; hop++) {
        const link = join(root, `hop${hop}`);

        symlinkSync(previous, link);
        previous = link;
      }

      expect((refusal(() => tryStatSync(previous)) as InvalidPathError).reason).toBe('unresolvable');
    });

    // The spelling is what the reader has to go act on, and a cycle has no
    // target to name instead.
    it('names the path it was given', async () => {
      const root = await tempRoot();
      const path = join(root, 'self');

      symlinkSync(path, path);

      expect(refusal(() => tryStatSync(path)).message).toBe(
        `${path} cannot be resolved: too many levels of symbolic links`,
      );
    });
  });
});

/** The error a refusal threw, so its whole message can be asserted on. */
function refusal(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}
