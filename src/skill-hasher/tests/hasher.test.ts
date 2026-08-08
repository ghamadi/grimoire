import {
  chmodSync,
  cpSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTreeHasher } from '../hasher.ts';
import { InvalidPathError, UnportableSkillError } from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';

describe('createTreeHasher, hash', () => {
  it('hashes identical trees equal', async () => {
    const a = await newFixture();
    const b = await newFixture();

    a.file('SKILL.md', '# triage');
    a.file('reference/notes.md', 'notes');
    b.file('SKILL.md', '# triage');
    b.file('reference/notes.md', 'notes');

    const hasher = createTreeHasher({ ignore: [] });

    expect(hasher.hash(a.root)).toBe(hasher.hash(b.root));
  });

  it('differs on a one-byte content change', async () => {
    const a = await newFixture();
    const b = await newFixture();

    a.file('SKILL.md', '# triage');
    b.file('SKILL.md', '# triagz');

    const hasher = createTreeHasher({ ignore: [] });

    expect(hasher.hash(a.root)).not.toBe(hasher.hash(b.root));
  });

  it('differs on a renamed file with identical bytes', async () => {
    const a = await newFixture();
    const b = await newFixture();

    a.file('SKILL.md', '# triage');
    a.file('reference/notes.md', 'same content');
    b.file('SKILL.md', '# triage');
    b.file('reference/other.md', 'same content');

    const hasher = createTreeHasher({ ignore: [] });

    expect(hasher.hash(a.root)).not.toBe(hasher.hash(b.root));
  });

  it('hashes the same content equal at two bucket depths', async () => {
    const a = await newFixture('a/triage');
    const b = await newFixture('x/y/z/triage');

    a.file('SKILL.md', '# triage');
    b.file('SKILL.md', '# triage');

    const hasher = createTreeHasher({ ignore: [] });

    expect(hasher.hash(a.root)).toBe(hasher.hash(b.root));
  });

  it('hashes a cp -R copy with fresh mtimes equal to its source', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# triage');
    a.file('reference/notes.md', 'notes');

    const copyRoot = join(await tempRoot(), 'copy');

    cpSync(a.root, copyRoot, { recursive: true });
    touchRecursively(copyRoot, new Date('2001-01-01'));

    const hasher = createTreeHasher({ ignore: [] });

    expect(hasher.hash(copyRoot)).toBe(hasher.hash(a.root));
  });

  it('hashes a .DS_Store away, at the root and nested', async () => {
    const a = await newFixture();
    const b = await newFixture();

    a.file('SKILL.md', '# triage');
    a.file('.DS_Store', 'junk');
    a.file('reference/.DS_Store', 'junk');
    b.file('SKILL.md', '# triage');

    const hasher = createTreeHasher({ ignore: ['.DS_Store'] });

    expect(hasher.hash(a.root)).toBe(hasher.hash(b.root));
  });

  it('changes the hash only for files the ignore list actually matches', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# triage');

    const hasher = createTreeHasher({ ignore: ['*.tmp'] });
    const base = hasher.hash(a.root);

    a.file('scratch.tmp', 'ignored');
    expect(hasher.hash(a.root)).toBe(base);

    a.file('extra.md', 'not ignored');
    expect(hasher.hash(a.root)).not.toBe(base);
  });

  it('keeps two skills apart under a pattern that would otherwise eat SKILL.md', async () => {
    const a = await newFixture('a');
    const b = await newFixture('b');

    a.file('SKILL.md', '# triage');
    b.file('SKILL.md', '# brainstorm, an entirely different skill');

    const hasher = createTreeHasher({ ignore: ['*.md'] });

    expect(hasher.hash(a.root)).not.toBe(hasher.hash(b.root));
  });

  it('differs on a chmod +x with identical bytes', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# My Skill \n\n ## Instructions\n\nExecute `./scripts/run.sh`.');
    const script = a.file('scripts/run.sh', '#!/bin/sh\necho hi');

    const hasher = createTreeHasher({ ignore: [] });
    const before = hasher.hash(a.root);

    chmodSync(script, 0o755);

    expect(hasher.hash(a.root)).not.toBe(before);
  });

  it('ignores the rest of the mode, so a umask difference is not a content change', async () => {
    const a = await newFixture();

    const manifest = a.file('SKILL.md', '# triage');

    const hasher = createTreeHasher({ ignore: [] });

    chmodSync(manifest, 0o644);
    const permissive = hasher.hash(a.root);

    chmodSync(manifest, 0o600);

    expect(hasher.hash(a.root)).toBe(permissive);
  });

  it('leaves the hash alone when an empty directory is added', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# triage');

    const hasher = createTreeHasher({ ignore: [] });
    const base = hasher.hash(a.root);

    a.directory('empty');

    expect(hasher.hash(a.root)).toBe(base);
  });

  it('hashes binary content and an empty file without incident', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# triage');
    a.file('asset.bin', Buffer.from([0x00, 0xff, 0x10, 0x80, 0x00]));
    a.file('empty.md', '');

    const hasher = createTreeHasher({ ignore: [] });

    expect(() => hasher.hash(a.root)).not.toThrow();
  });
});

describe('createTreeHasher, hash, refusals and boundaries', () => {
  it('throws UnportableSkillError on a symlink inside the skill, naming the skill and the entry', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# triage');
    a.file('elsewhere/notes.md', 'notes');
    a.link('reference/notes.md', join(a.root, 'elsewhere/notes.md'));

    const hasher = createTreeHasher({ ignore: [] });

    try {
      hasher.hash(a.root);
      expect.fail('expected hash to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnportableSkillError);
      const unportable = error as UnportableSkillError;
      expect(unportable.path).toBe(a.root);
      expect(unportable.entry).toBe('reference/notes.md');
    }
  });

  it('hashes a skill reached by a symlink at its root equal to the same skill reached directly', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# triage');
    a.file('reference/notes.md', 'notes');

    const linkPath = join(await tempRoot(), 'linked-skill');

    symlinkSync(a.root, linkPath);

    const hasher = createTreeHasher({ ignore: [] });

    expect(hasher.hash(linkPath)).toBe(hasher.hash(a.root));
  });

  it('prunes an ignored directory instead of descending into it', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# triage');
    a.file('build/output.js', 'built');
    a.link('build/vendored', join(a.root, 'build/output.js'));

    const hasher = createTreeHasher({ ignore: ['build'] });

    expect(() => hasher.hash(a.root)).not.toThrow();
  });

  it('cannot have its hash changed by a file that ignores() matches', async () => {
    const a = await newFixture();

    a.file('SKILL.md', '# triage');

    const hasher = createTreeHasher({ ignore: ['*.tmp'] });
    const base = hasher.hash(a.root);

    a.file('scratch.tmp', 'some arbitrary content that would otherwise change the hash');

    expect(hasher.ignores('scratch.tmp')).toBe(true);
    expect(hasher.hash(a.root)).toBe(base);
  });

  it('throws InvalidPathError on a missing root', async () => {
    const root = await tempRoot();
    const hasher = createTreeHasher({ ignore: [] });

    expect(() => hasher.hash(join(root, 'nope'))).toThrow(InvalidPathError);
  });

  it('throws InvalidPathError on a directory holding no SKILL.md', async () => {
    const bucket = await newFixture('writing');

    bucket.file('triage/SKILL.md', '# triage');

    const hasher = createTreeHasher({ ignore: [] });

    expect(() => hasher.hash(bucket.root)).toThrow(InvalidPathError);
    expect(() => hasher.hash(join(bucket.root, 'triage'))).not.toThrow();
  });

  it('throws InvalidPathError when the root is a file', async () => {
    const root = await tempRoot();
    const file = join(root, 'notes.md');

    writeFileSync(file, '# notes', 'utf8');

    const hasher = createTreeHasher({ ignore: [] });

    expect(() => hasher.hash(file)).toThrow(InvalidPathError);
  });
});

/** A skill directory built by hand, since no command writes one yet. */
async function newFixture(subpath = 'skill') {
  const created = join(await tempRoot(), subpath);

  mkdirSync(created, { recursive: true });

  const root = realpathSync(created);

  function file(rel: string, content: string | Buffer): string {
    const filePath = join(root, rel);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);

    return filePath;
  }

  function directory(rel: string): string {
    const dirPath = join(root, rel);

    mkdirSync(dirPath, { recursive: true });

    return dirPath;
  }

  function link(rel: string, target: string): string {
    const linkPath = join(root, rel);

    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath);

    return linkPath;
  }

  return { root, file, directory, link };
}

/** Sets every file's mtime under `dir` to `date`, recursively. */
function touchRecursively(dir: string, date: Date): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      touchRecursively(path, date);
    } else if (entry.isFile()) {
      utimesSync(path, date, date);
    }
  }
}
