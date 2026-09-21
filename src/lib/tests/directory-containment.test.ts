import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidPathError } from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';
import { compareContainment, compareDirectories } from '../directory-containment.ts';

describe('compareContainment', () => {
  describe('what it proves contained', () => {
    it('accepts two identical trees', async () => {
      const pair = await newPair();

      for (const tree of [pair.candidate, pair.reference]) {
        tree.file('SKILL.md', '# skill');
        tree.file('reference/notes.md', 'notes');
      }

      expect(compare(pair)).toEqual({ kind: 'contained' });
    });

    it('accepts an empty candidate', async () => {
      const pair = await newPair();

      pair.reference.file('SKILL.md', '# skill');

      expect(compare(pair)).toEqual({ kind: 'contained' });
    });

    // Containment, not equality: after the caller acts, the candidate is the
    // reference, so what it was missing arrives rather than being lost.
    it('accepts a candidate holding only some of what the reference holds', async () => {
      const pair = await newPair();

      pair.candidate.file('SKILL.md', '# skill');

      pair.reference.file('SKILL.md', '# skill');
      pair.reference.file('reference/notes.md', 'notes');

      expect(compare(pair)).toEqual({ kind: 'contained' });
    });

    it('accepts a reference holding a file an ignore list would have skipped', async () => {
      const pair = await newPair();

      pair.candidate.file('SKILL.md', '# skill');

      pair.reference.file('SKILL.md', '# skill');
      pair.reference.file('.DS_Store', 'junk');

      expect(compare(pair)).toEqual({ kind: 'contained' });
    });

    it('accepts an empty directory the reference also holds', async () => {
      const pair = await newPair();

      pair.candidate.directory('scripts');
      pair.reference.directory('scripts');

      expect(compare(pair)).toEqual({ kind: 'contained' });
    });

    it('accepts an executable file the reference holds as executable', async () => {
      const pair = await newPair();

      pair.candidate.file('run.sh', 'echo hi', { executable: true });
      pair.reference.file('run.sh', 'echo hi', { executable: true });

      expect(compare(pair)).toEqual({ kind: 'contained' });
    });

    it('compares a candidate root that is a symlink as the directory it names', async () => {
      const pair = await newPair();
      const target = pair.candidate.directory('real');

      pair.candidate.file('real/SKILL.md', '# skill');
      pair.reference.file('SKILL.md', '# skill');

      expect(compareContainment({ candidate: target, reference: pair.reference.root })).toEqual({
        kind: 'contained',
      });
    });
  });

  describe('what it reports as a difference', () => {
    // The whole reason the ignore list stays out: this file is the user's, and
    // the reference cannot vouch for it.
    it('reports a file the reference does not hold at all', async () => {
      const pair = await newPair();

      pair.candidate.file('SKILL.md', '# skill');
      pair.candidate.file('.DS_Store', 'junk');
      pair.reference.file('SKILL.md', '# skill');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: '.DS_Store' });
    });

    it('reports a file whose content disagrees', async () => {
      const pair = await newPair();

      pair.candidate.file('SKILL.md', '# theirs');
      pair.reference.file('SKILL.md', '# ours');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: 'SKILL.md' });
    });

    it('reports content that disagrees at the same length', async () => {
      const pair = await newPair();

      pair.candidate.file('SKILL.md', 'a');
      pair.reference.file('SKILL.md', 'b');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: 'SKILL.md' });
    });

    it('reports identical content carrying a different executable bit', async () => {
      const pair = await newPair();

      pair.candidate.file('scripts/run.sh', 'echo hi', { executable: true });
      pair.reference.file('scripts/run.sh', 'echo hi');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: 'scripts/run.sh' });
    });

    it('reports a file the reference holds as a directory', async () => {
      const pair = await newPair();

      pair.candidate.file('reference', 'notes');
      pair.reference.directory('reference');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: 'reference' });
    });

    it('reports a directory the reference holds as a file', async () => {
      const pair = await newPair();

      pair.candidate.file('reference/notes.md', 'notes');
      pair.reference.file('reference', 'notes');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: 'reference' });
    });

    // An empty directory holds nothing, but deleting it is still a deletion.
    it('reports an empty directory the reference does not hold', async () => {
      const pair = await newPair();

      pair.candidate.directory('scripts');
      pair.reference.file('SKILL.md', '# skill');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: 'scripts' });
    });

    it('names the first offender in lexicographic order', async () => {
      const pair = await newPair();

      pair.candidate.file('alpha.md', 'a');
      pair.candidate.file('zulu.md', 'z');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: 'alpha.md' });
    });

    it('names an offender found by descending before one beside it', async () => {
      const pair = await newPair();

      pair.candidate.file('alpha/notes.md', 'notes');
      pair.candidate.file('beta.md', 'b');
      pair.reference.directory('alpha');

      expect(compare(pair)).toEqual({ kind: 'differs', entry: 'alpha/notes.md' });
    });
  });

  describe('what it cannot compare', () => {
    it('reports a symlink beneath the candidate, naming the candidate root', async () => {
      const pair = await newPair();

      pair.candidate.file('SKILL.md', '# skill');
      pair.candidate.link('alias.md', join(pair.candidate.root, 'SKILL.md'));
      pair.reference.file('SKILL.md', '# skill');

      expect(compare(pair)).toEqual({
        kind: 'unportable',
        root: pair.candidate.root,
        entry: 'alias.md',
      });
    });

    it('reports a symlink beneath the reference, naming the reference root', async () => {
      const pair = await newPair();

      pair.candidate.file('SKILL.md', '# skill');
      pair.candidate.file('alias.md', '# skill');

      pair.reference.file('SKILL.md', '# skill');
      pair.reference.link('alias.md', join(pair.reference.root, 'SKILL.md'));

      expect(compare(pair)).toEqual({
        kind: 'unportable',
        root: pair.reference.root,
        entry: 'alias.md',
      });
    });

    it('reports a symlink to a directory rather than descending into it', async () => {
      const pair = await newPair();
      const target = pair.reference.directory('scripts');

      pair.candidate.link('scripts', target);

      expect(compare(pair)).toEqual({
        kind: 'unportable',
        root: pair.candidate.root,
        entry: 'scripts',
      });
    });

    it('reports a dangling symlink rather than failing on it', async () => {
      const pair = await newPair();

      pair.candidate.link('alias.md', join(pair.candidate.root, 'gone.md'));

      expect(compare(pair)).toEqual({
        kind: 'unportable',
        root: pair.candidate.root,
        entry: 'alias.md',
      });
    });
  });

  describe('the directories it refuses to answer about', () => {
    it('throws on a candidate that does not exist', async () => {
      const pair = await newPair();

      expect(() =>
        compareContainment({
          candidate: join(pair.candidate.root, 'gone'),
          reference: pair.reference.root,
        }),
      ).toThrow(InvalidPathError);
    });

    it('throws on a reference that does not exist', async () => {
      const pair = await newPair();

      expect(() =>
        compareContainment({
          candidate: pair.candidate.root,
          reference: join(pair.reference.root, 'gone'),
        }),
      ).toThrow(InvalidPathError);
    });

    it('throws on a candidate that is a file', async () => {
      const pair = await newPair();
      const file = pair.candidate.file('notes.md', 'notes');

      expect(() => compareContainment({ candidate: file, reference: pair.reference.root })).toThrow(
        InvalidPathError,
      );
    });
  });
});

describe('compareDirectories', () => {
  it('reports two identical trees as identical', async () => {
    const sides = await newSides();

    for (const tree of [sides.left, sides.right]) {
      tree.file('SKILL.md', '# skill');
      tree.file('reference/notes.md', 'notes');
      tree.directory('scripts');
    }

    expect(compareSides(sides)).toEqual({ kind: 'identical' });
  });

  it('reports disagreeing content the first pass already catches', async () => {
    const sides = await newSides();

    sides.left.file('SKILL.md', '# theirs');
    sides.right.file('SKILL.md', '# ours');

    expect(compareSides(sides)).toEqual({ kind: 'differs', entry: 'SKILL.md' });
  });

  it('reports an entry only the left holds', async () => {
    const sides = await newSides();

    sides.left.file('SKILL.md', '# skill');
    sides.left.file('notes.md', 'notes');
    sides.right.file('SKILL.md', '# skill');

    expect(compareSides(sides)).toEqual({ kind: 'differs', entry: 'notes.md' });
  });

  it('reports an entry only the right holds, named right-relative', async () => {
    const sides = await newSides();

    sides.left.file('reference/shared.md', 'shared');
    sides.right.file('reference/shared.md', 'shared');
    sides.right.file('reference/notes.md', 'notes');

    expect(compareSides(sides)).toEqual({ kind: 'differs', entry: 'reference/notes.md' });
  });

  it('reports a symlink held by the left, naming the left root', async () => {
    const sides = await newSides();

    sides.left.file('SKILL.md', '# skill');
    sides.left.link('alias.md', join(sides.left.root, 'SKILL.md'));
    sides.right.file('SKILL.md', '# skill');

    expect(compareSides(sides)).toEqual({
      kind: 'unportable',
      root: sides.left.root,
      entry: 'alias.md',
    });
  });

  it('reports a symlink held by the right, naming the right root', async () => {
    const sides = await newSides();

    sides.left.file('SKILL.md', '# skill');
    sides.right.file('SKILL.md', '# skill');
    sides.right.link('alias.md', join(sides.right.root, 'SKILL.md'));

    expect(compareSides(sides)).toEqual({
      kind: 'unportable',
      root: sides.right.root,
      entry: 'alias.md',
    });
  });

  it('reports the left side offender when both sides offend', async () => {
    const sides = await newSides();

    sides.left.file('SKILL.md', '# skill');
    sides.left.file('left-only.md', 'left');

    sides.right.file('SKILL.md', '# skill');
    sides.right.link('alias.md', join(sides.right.root, 'SKILL.md'));

    expect(compareSides(sides)).toEqual({ kind: 'differs', entry: 'left-only.md' });
  });

  it('throws on a left that does not exist', async () => {
    const sides = await newSides();

    expect(() =>
      compareDirectories({ left: join(sides.left.root, 'gone'), right: sides.right.root }),
    ).toThrow(InvalidPathError);
  });

  it('throws on a right that does not exist', async () => {
    const sides = await newSides();

    expect(() =>
      compareDirectories({ left: sides.left.root, right: join(sides.right.root, 'gone') }),
    ).toThrow(InvalidPathError);
  });
});

// -----------------------------------------------------------------------------
// FIXTURES
// -----------------------------------------------------------------------------

type Tree = ReturnType<typeof newTree>;

function compare(pair: { candidate: Tree; reference: Tree }) {
  return compareContainment({ candidate: pair.candidate.root, reference: pair.reference.root });
}

async function newPair() {
  const root = await tempRoot();

  return {
    candidate: newTree(join(root, 'candidate')),
    reference: newTree(join(root, 'reference')),
  };
}

async function newSides() {
  const root = await tempRoot();

  return {
    left: newTree(join(root, 'left')),
    right: newTree(join(root, 'right')),
  };
}

function compareSides(sides: { left: Tree; right: Tree }) {
  return compareDirectories({ left: sides.left.root, right: sides.right.root });
}

function newTree(root: string) {
  mkdirSync(root, { recursive: true });

  function file(rel: string, content: string, options?: { executable?: boolean }): string {
    const filePath = join(root, rel);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);

    if (options?.executable) {
      chmodSync(filePath, 0o755);
    }

    return filePath;
  }

  function directory(rel: string): string {
    const directoryPath = join(root, rel);

    mkdirSync(directoryPath, { recursive: true });

    return directoryPath;
  }

  function link(rel: string, target: string): string {
    const linkPath = join(root, rel);

    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath);

    return linkPath;
  }

  return { root, file, directory, link };
}
