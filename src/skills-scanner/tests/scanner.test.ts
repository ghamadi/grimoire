import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanSkills } from '../scanner.ts';
import { InvalidPathError } from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';

describe('scanSkills', () => {
  it('returns every skill at the root, sorted by name', async () => {
    const { root, skill } = await newFixture();

    const triage = skill('triage');
    const brainstorm = skill('brainstorm');

    expect(scanSkills(root)).toEqual([
      { name: 'brainstorm', path: brainstorm },
      { name: 'triage', path: triage },
    ]);
  });

  it('sorts by code point, so an uppercase name comes before a lowercase one', async () => {
    const { root, skill } = await newFixture();

    skill('Zed');
    skill('ab');
    skill('a-x');

    expect(scanSkills(root).map(({ name }) => name)).toEqual(['Zed', 'a-x', 'ab']);
  });

  it('flattens a skill nested under buckets to its name', async () => {
    const { root, skill } = await newFixture();

    const triage = skill('a/b/triage');

    expect(scanSkills(root)).toEqual([{ name: 'triage', path: triage }]);
  });

  it('never descends into a skill directory', async () => {
    const { root, skill } = await newFixture();

    const brainstorm = skill('brainstorm');
    skill('brainstorm/nested');

    expect(scanSkills(root)).toEqual([{ name: 'brainstorm', path: brainstorm }]);
  });

  it('descends into a bucket sharing a name with a skill already found', async () => {
    const { root, skill } = await newFixture();

    const triage = skill('a/triage');
    const brainstorm = skill('triage/brainstorm');

    expect(scanSkills(root)).toEqual([
      { name: 'brainstorm', path: brainstorm },
      { name: 'triage', path: triage },
    ]);
  });

  it('returns a root holding SKILL.md as the skill it is', async () => {
    const root = join(await tempRoot(), 'brainstorm');

    mkdirSync(join(root, 'reference'), { recursive: true });
    writeFileSync(join(root, 'SKILL.md'), '# brainstorm', 'utf8');

    expect(scanSkills(root)).toEqual([{ name: 'brainstorm', path: realpathSync(root) }]);
  });

  it('reads a mixed tree', async () => {
    const { root, skill, directory, link } = await newFixture();

    skill('brainstorm');
    skill('a/b/triage');
    skill('deep/deeper/brainstorm');
    directory('notes');
    link({ at: 'vendored', to: skill('elsewhere/review') });

    expect(scanSkills(root).map(({ name }) => name)).toEqual(['brainstorm', 'review', 'triage']);
  });
});

describe('scanSkills, on a name held twice', () => {
  it('keeps the copy the walk reaches first, however deep', async () => {
    const { root, skill } = await newFixture();

    const first = skill('a/b/c/triage');

    skill('triage');

    expect(scanSkills(root)).toEqual([{ name: 'triage', path: first }]);
  });

  it('takes the earlier bucket when two hold the name', async () => {
    const { root, skill } = await newFixture();

    skill('b/triage');
    const first = skill('a/triage');

    expect(scanSkills(root)).toEqual([{ name: 'triage', path: first }]);
  });

  it('orders a directory entry by entry, so a/ is entered before a-x/', async () => {
    const { root, skill } = await newFixture();

    skill('a-x/triage');
    const first = skill('a/triage');

    expect(scanSkills(root)).toEqual([{ name: 'triage', path: first }]);
  });

  it('reports the ignored copy nowhere at all', async () => {
    const { root, skill } = await newFixture();

    skill('a/triage');

    const ignored = skill('zz/triage');

    expect(JSON.stringify(scanSkills(root))).not.toContain(ignored);
  });
});

describe('scanSkills, on a directory holding no skill', () => {
  it('yields nothing for it', async () => {
    const { root, skill, directory } = await newFixture();

    const brainstorm = skill('brainstorm');

    directory('notes/drafts/old');

    expect(scanSkills(root)).toEqual([{ name: 'brainstorm', path: brainstorm }]);
  });

  it('returns nothing at all for a root holding none anywhere', async () => {
    const { root, directory } = await newFixture();

    directory('notes/drafts');

    expect(scanSkills(root)).toEqual([]);
  });
});

describe('scanSkills, on a dot-directory', () => {
  it('never descends into it, so a repo can keep .git beside its skills', async () => {
    const { root, skill } = await newFixture();

    const brainstorm = skill('brainstorm');

    skill('.git/objects/triage');

    expect(scanSkills(root)).toEqual([{ name: 'brainstorm', path: brainstorm }]);
  });

  it('treats a dot-named skill as no skill at all', async () => {
    const { root, skill } = await newFixture();

    skill('.hidden');

    expect(scanSkills(root)).toEqual([]);
  });

  it('treats one as no skill even when the link reaching it is not dot-named', async () => {
    const { root, skill, link } = await newFixture();

    link({ at: 'visible', to: skill('vendor/.hidden') });

    expect(scanSkills(root)).toEqual([]);
  });

  it('reads a dot-named root, so a store backup stays importable', async () => {
    const root = join(await tempRoot(), '.backup');
    const brainstorm = join(root, 'brainstorm');

    mkdirSync(brainstorm, { recursive: true });
    writeFileSync(join(brainstorm, 'SKILL.md'), '# brainstorm', 'utf8');

    expect(scanSkills(root)).toEqual([{ name: 'brainstorm', path: realpathSync(brainstorm) }]);
  });
});

describe('scanSkills, on a symlinked entry', () => {
  it('finds a linked skill at its target, not at the link', async () => {
    const { root, skill, link } = await newFixture();

    const vendored = skill('vendored/triage');
    const brainstorm = skill('brainstorm');

    link({ at: 'triage', to: vendored });

    expect(scanSkills(root)).toEqual([
      { name: 'brainstorm', path: brainstorm },
      { name: 'triage', path: vendored },
    ]);
  });

  it('reads one directory reached by two names as one skill, named for the directory', async () => {
    const { root, skill, link } = await newFixture();

    const triage = skill('vendored/triage');

    link({ at: 'review', to: triage });

    expect(scanSkills(root)).toEqual([{ name: 'triage', path: triage }]);
  });

  it('descends into a linked bucket', async () => {
    const elsewhere = realpathSync(await tempRoot());
    const { root, link } = await newFixture();

    mkdirSync(join(elsewhere, 'bucket', 'triage'), { recursive: true });
    writeFileSync(join(elsewhere, 'bucket', 'triage', 'SKILL.md'), '# triage', 'utf8');
    link({ at: 'vendored', to: join(elsewhere, 'bucket') });

    expect(scanSkills(root)).toEqual([{ name: 'triage', path: join(elsewhere, 'bucket', 'triage') }]);
  });

  it('follows a dot-named link, since the skill is named by its target', async () => {
    const elsewhere = realpathSync(await tempRoot());
    const { root, link } = await newFixture();

    const triage = join(elsewhere, 'triage');

    mkdirSync(triage, { recursive: true });
    writeFileSync(join(triage, 'SKILL.md'), '# triage', 'utf8');
    link({ at: '.old', to: triage });

    expect(scanSkills(root)).toEqual([{ name: 'triage', path: triage }]);
  });

  it('passes over a dangling link', async () => {
    const { root, skill, link } = await newFixture();

    const brainstorm = skill('brainstorm');

    link({ at: 'triage', to: join(root, 'gone') });

    expect(scanSkills(root)).toEqual([{ name: 'brainstorm', path: brainstorm }]);
  });

  it('passes over a link whose target sits under a file', async () => {
    const { root, skill, link } = await newFixture();

    const brainstorm = skill('brainstorm');
    const notes = join(root, 'notes.md');

    writeFileSync(notes, '# notes', 'utf8');
    link({ at: 'triage', to: join(notes, 'child') });

    expect(scanSkills(root)).toEqual([{ name: 'brainstorm', path: brainstorm }]);
  });

  it('passes over a link pointing at itself', async () => {
    const { root, skill, link } = await newFixture();

    const brainstorm = skill('brainstorm');

    link({ at: 'triage', to: join(root, 'triage') });

    expect(scanSkills(root)).toEqual([{ name: 'brainstorm', path: brainstorm }]);
  });

  it('yields each skill in a cycle once', async () => {
    const { root, skill, link } = await newFixture();

    const triage = skill('cyc/triage');

    link({ at: 'cyc/self', to: join(root, 'cyc') });

    expect(scanSkills(root)).toEqual([{ name: 'triage', path: triage }]);
  });
});

describe('scanSkills, on an unusable root', () => {
  it('refuses a root that does not exist', async () => {
    const { root } = await newFixture();

    expect(() => scanSkills(join(root, 'nope'))).toThrow(InvalidPathError);
  });

  it('refuses a root that is a file', async () => {
    const { root } = await newFixture();
    const file = join(root, 'notes.md');

    writeFileSync(file, '# notes', 'utf8');

    expect(() => scanSkills(file)).toThrow(InvalidPathError);
  });
});

/**
 * A skills directory built by hand, since no command writes one yet.
 *
 * Every path is relative to the root, and intermediate segments are created on
 * the way, so a bucket is whatever a skill was nested under.
 */
async function newFixture() {
  const created = join(await tempRoot(), 'skills');

  mkdirSync(created, { recursive: true });

  // The scan resolves every path it reports, and the temp root sits under a
  // symlinked /var, so an unresolved root matches none of them.
  const root = realpathSync(created);

  function skill(path: string): string {
    const skillPath = directory(path);

    writeFileSync(join(skillPath, 'SKILL.md'), `# ${path}`, 'utf8');

    return skillPath;
  }

  function directory(path: string): string {
    const directoryPath = join(root, path);

    mkdirSync(directoryPath, { recursive: true });

    return directoryPath;
  }

  function link(options: { at: string; to: string }): string {
    const linkPath = join(root, options.at);

    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(options.to, linkPath);

    return linkPath;
  }

  return { root, skill, directory, link };
}
