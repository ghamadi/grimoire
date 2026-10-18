import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSkillSources } from '@/domains/skill/helpers/skill-sources';
import { SKILL_MANIFEST } from '@/domains/skill/entity';
import { InvalidPathError } from '@/lib/errors';
import { tempRoot } from '@test-helpers/temp-root';

describe('findSkillSources', () => {
  it('reports the named directory itself when it is a skill', async () => {
    const skill = writeSkillDirectory(join(await tempRoot(), 'triage'));

    expect(findSkillSources({ path: skill })).toEqual([{ name: 'triage', path: skill }]);
  });

  it('finds a skill several levels down', async () => {
    const root = await tempRoot();
    const skill = writeSkillDirectory(join(root, 'a', 'b', 'c', 'triage'));

    expect(findSkillSources({ path: root })).toEqual([{ name: 'triage', path: skill }]);
  });

  it('stops descending once it identifies a skill, ignoring anything nested inside it', async () => {
    const root = await tempRoot();
    const outer = writeSkillDirectory(join(root, 'outer'));
    writeSkillDirectory(join(root, 'outer', 'inner'));

    expect(findSkillSources({ path: root })).toEqual([{ name: 'outer', path: outer }]);
  });

  it('skips an entry whose name starts with a dot', async () => {
    const root = await tempRoot();
    writeSkillDirectory(join(root, '.git', 'triage'));
    const kept = writeSkillDirectory(join(root, 'brainstorm'));

    expect(findSkillSources({ path: root })).toEqual([{ name: 'brainstorm', path: kept }]);
  });

  it('does not discover a copy a clone left in a workspace staging directory', async () => {
    const root = await tempRoot();
    writeSkillDirectory(join(root, '.grimoire-staging', 'triage.abc.incoming'));

    expect(findSkillSources({ path: root })).toEqual([]);
  });

  it('crawls a dot-named root anyway', async () => {
    const root = await tempRoot();
    const skillsDir = join(root, '.claude', 'skills');
    const skill = writeSkillDirectory(join(skillsDir, 'triage'));

    expect(findSkillSources({ path: skillsDir })).toEqual([{ name: 'triage', path: skill }]);
  });

  it('returns nothing for a container holding no skills', async () => {
    const root = await tempRoot();
    mkdirSync(join(root, 'empty'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'readme.md'), '# docs', 'utf8');
    writeFileSync(join(root, 'notes.md'), '# notes', 'utf8');

    expect(findSkillSources({ path: root })).toEqual([]);
  });

  it('reports both sources when two skills share a name, ordered by path', async () => {
    const root = await tempRoot();
    const first = writeSkillDirectory(join(root, 'a', 'triage'));
    const second = writeSkillDirectory(join(root, 'b', 'triage'));

    expect(findSkillSources({ path: root })).toEqual([
      { name: 'triage', path: first },
      { name: 'triage', path: second },
    ]);
  });

  it('sorts results by name regardless of walk order', async () => {
    const root = await tempRoot();
    const triage = writeSkillDirectory(join(root, 'a', 'triage'));
    const brainstorm = writeSkillDirectory(join(root, 'b', 'brainstorm'));

    expect(findSkillSources({ path: root })).toEqual([
      { name: 'brainstorm', path: brainstorm },
      { name: 'triage', path: triage },
    ]);
  });

  it('neither descends into nor reports a symlinked subdirectory', async () => {
    const root = await tempRoot();
    const elsewhere = await tempRoot();
    writeSkillDirectory(join(elsewhere, 'triage'));

    symlinkSync(join(elsewhere, 'triage'), join(root, 'triage'));
    symlinkSync(elsewhere, join(root, 'vendored'));

    expect(findSkillSources({ path: root })).toEqual([]);
  });

  it('drops a trailing separator on the input without changing the name', async () => {
    const root = await tempRoot();
    const skill = writeSkillDirectory(join(root, 'triage'));

    expect(findSkillSources({ path: `${skill}/` })).toEqual([{ name: 'triage', path: skill }]);
  });

  it('throws InvalidPathError for a path that does not exist', async () => {
    const root = await tempRoot();

    expect(() => findSkillSources({ path: join(root, 'missing') })).toThrow(InvalidPathError);
  });

  it('throws InvalidPathError for a path that is a regular file', async () => {
    const root = await tempRoot();
    const file = join(root, 'notes.md');
    writeFileSync(file, '# notes', 'utf8');

    expect(() => findSkillSources({ path: file })).toThrow(InvalidPathError);
  });
});

function writeSkillDirectory(path: string): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, SKILL_MANIFEST), '# skill\n', 'utf8');

  return path;
}
