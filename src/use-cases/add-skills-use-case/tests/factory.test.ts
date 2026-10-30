import { existsSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store';
import { SKILL_MANIFEST, type SkillSource } from '@/domains/skill';
import { AddDeclinedError, InvalidPathError } from '@/lib/errors';
import { DS_STORE_NAME, finderDsStoreBytes } from '@test-helpers/ds-store';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';
import { createAddSkillsUseCase } from '@/use-cases/add-skills-use-case/factory';

describe('add-skills-use-case factory', () => {
  describe('what it adds', () => {
    it('copies a free name into the store, reporting where it landed', async () => {
      const { addSkills, store, source } = await newUseCase();
      const brainstorm = source('brainstorm');

      const report = addSkills({ sources: [brainstorm] });

      expect(report.added).toEqual([
        { skill: 'brainstorm', storePath: join(store.paths.skills, 'brainstorm') },
      ]);
      expect(existsSync(join(store.paths.skills, 'brainstorm', SKILL_MANIFEST))).toBe(true);
    });

    it('reports several sources in the order given', async () => {
      const { addSkills, source } = await newUseCase();
      const brainstorm = source('brainstorm');
      const triage = source('triage');

      const report = addSkills({ sources: [triage, brainstorm] });

      expect(report.added.map(({ skill }) => skill)).toEqual(['triage', 'brainstorm']);
    });
  });

  describe('what it finds already there', () => {
    it('reports a matching source as present, writing nothing', async () => {
      const { addSkills, store, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm');
      const brainstorm = source('brainstorm');
      const before = statSync(join(store.paths.skills, 'brainstorm', SKILL_MANIFEST)).mtimeMs;

      const report = addSkills({ sources: [brainstorm] });

      expect(report.present).toEqual([{ skill: 'brainstorm', storeExtra: undefined }]);
      expect(report.added).toEqual([]);
      expect(statSync(join(store.paths.skills, 'brainstorm', SKILL_MANIFEST)).mtimeMs).toBe(before);
    });

    it('reports a source present when it differs from the store copy only by a Finder .DS_Store', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm');
      const brainstorm = source('brainstorm', { [DS_STORE_NAME]: finderDsStoreBytes() });

      const report = addSkills({ sources: [brainstorm] });

      expect(report.present).toEqual([{ skill: 'brainstorm', storeExtra: undefined }]);
      expect(report.declined).toEqual([]);
    });
  });

  describe('what it declines', () => {
    it('declines a source whose store copy differs, naming the entry', async () => {
      const { addSkills, store, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm', { [SKILL_MANIFEST]: 'store version' });
      const brainstorm = source('brainstorm', { [SKILL_MANIFEST]: 'source version' });

      const error = refusal(() => addSkills({ sources: [brainstorm] }));

      expect((error as AddDeclinedError).refusals).toEqual([
        {
          kind: 'differs',
          skill: 'brainstorm',
          storePath: join(store.paths.skills, 'brainstorm'),
          entry: SKILL_MANIFEST,
        },
      ]);
    });

    it('declines a source holding a symlink, naming the source as root', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm');
      const brainstorm = source('brainstorm');
      symlinkSync(join(brainstorm.path, SKILL_MANIFEST), join(brainstorm.path, 'link.md'));

      const error = refusal(() => addSkills({ sources: [brainstorm] }));

      expect((error as AddDeclinedError).refusals).toEqual([
        { kind: 'incomparable', skill: 'brainstorm', root: brainstorm.path, entry: 'link.md' },
      ]);
    });

    it('declines a store copy holding a symlink where the source holds a file, naming the store as root', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      const storePath = storeSkill('brainstorm');
      symlinkSync(join(storePath, SKILL_MANIFEST), join(storePath, 'link.md'));
      const brainstorm = source('brainstorm', { 'link.md': 'a real file' });

      const error = refusal(() => addSkills({ sources: [brainstorm] }));

      expect((error as AddDeclinedError).refusals).toEqual([
        { kind: 'incomparable', skill: 'brainstorm', root: storePath, entry: 'link.md' },
      ]);
    });

    it('declines a source holding an entry the store lacks, naming the entry', async () => {
      const { addSkills, store, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm');
      const brainstorm = source('brainstorm', { 'extra.md': 'only here' });

      const error = refusal(() => addSkills({ sources: [brainstorm] }));

      expect((error as AddDeclinedError).refusals).toEqual([
        {
          kind: 'differs',
          skill: 'brainstorm',
          storePath: join(store.paths.skills, 'brainstorm'),
          entry: 'extra.md',
        },
      ]);
    });

    it('declines a source holding a nested skill, before any store comparison', async () => {
      const { addSkills, store, source } = await newUseCase();
      const scratch = source('scratch', { 'sub/SKILL.md': '# nested\n' });

      const error = refusal(() => addSkills({ sources: [scratch] }));

      expect((error as AddDeclinedError).refusals).toEqual([
        { kind: 'unportable', skill: 'scratch', location: scratch.path, reason: 'nested-skill' },
      ]);
      expect(existsSync(join(store.paths.skills, 'scratch'))).toBe(false);
    });

    describe.skipIf(runsAsRoot)('permissions', () => {
      it('declines a source holding a folder it can list but not enter, and adds the rest', async () => {
        const { addSkills, store, source } = await newUseCase();
        const brainstorm = source('brainstorm');
        const scratch = source('scratch', { 'refs/guide.md': 'guide' });
        const triage = source('triage');

        lockDirectory({ path: join(scratch.path, 'refs'), mode: 0o600 });

        const report = addSkills({ sources: [brainstorm, scratch, triage] });

        expect(report.added.map(({ skill }) => skill)).toEqual(['brainstorm', 'triage']);
        expect(report.declined).toEqual([
          { kind: 'unreadable', skill: 'scratch', path: join(scratch.path, 'refs', 'guide.md') },
        ]);
        expect(existsSync(join(store.paths.skills, 'scratch'))).toBe(false);
      });
    });
  });

  describe('a source located apart from its path', () => {
    it('names the source by its location in an unportable refusal', async () => {
      const { addSkills, source } = await newUseCase();
      const scratch = {
        ...source('scratch', { 'sub/SKILL.md': '# nested\n' }),
        location: 'tools/scratch',
      };

      const error = refusal(() => addSkills({ sources: [scratch] }));

      expect((error as AddDeclinedError).refusals).toEqual([
        { kind: 'unportable', skill: 'scratch', location: 'tools/scratch', reason: 'nested-skill' },
      ]);
    });

    it('names the source by its location when the source holds the symlink', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm');
      const brainstorm = { ...source('brainstorm'), location: 'tools/brainstorm' };
      symlinkSync(join(brainstorm.path, SKILL_MANIFEST), join(brainstorm.path, 'link.md'));

      const error = refusal(() => addSkills({ sources: [brainstorm] }));

      expect((error as AddDeclinedError).refusals).toEqual([
        { kind: 'incomparable', skill: 'brainstorm', root: 'tools/brainstorm', entry: 'link.md' },
      ]);
    });

    it('keeps the store path when the store copy holds the symlink', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      const storePath = storeSkill('brainstorm');
      symlinkSync(join(storePath, SKILL_MANIFEST), join(storePath, 'link.md'));
      const brainstorm = {
        ...source('brainstorm', { 'link.md': 'a real file' }),
        location: 'tools/brainstorm',
      };

      const error = refusal(() => addSkills({ sources: [brainstorm] }));

      expect((error as AddDeclinedError).refusals).toEqual([
        { kind: 'incomparable', skill: 'brainstorm', root: storePath, entry: 'link.md' },
      ]);
    });
  });

  describe('when the store copy holds more than the source', () => {
    it('reports the source as present, naming the first entry the store also holds', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm', { 'notes.md': 'kept' });
      const brainstorm = source('brainstorm');

      const report = addSkills({ sources: [brainstorm] });

      expect(report.present).toEqual([{ skill: 'brainstorm', storeExtra: 'notes.md' }]);
      expect(report.declined).toEqual([]);
    });

    it('does not name a Finder .DS_Store as the entry the store also holds', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm', { [DS_STORE_NAME]: finderDsStoreBytes() });
      const brainstorm = source('brainstorm');

      const report = addSkills({ sources: [brainstorm] });

      expect(report.present).toEqual([{ skill: 'brainstorm', storeExtra: undefined }]);
    });

    it('leaves the extra the store holds in place', async () => {
      const { addSkills, store, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm', { 'notes.md': 'kept' });
      const brainstorm = source('brainstorm');

      addSkills({ sources: [brainstorm] });

      expect(existsSync(join(store.paths.skills, 'brainstorm', 'notes.md'))).toBe(true);
    });

    it('counts a symlink only the store holds as an extra rather than refusing the comparison', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      const storePath = storeSkill('brainstorm');
      symlinkSync(join(storePath, SKILL_MANIFEST), join(storePath, 'link.md'));
      const brainstorm = source('brainstorm');

      const report = addSkills({ sources: [brainstorm] });

      expect(report.present).toEqual([{ skill: 'brainstorm', storeExtra: 'link.md' }]);
    });
  });

  describe('two sources sharing a name', () => {
    it('adds the first and finds the second present when their trees match', async () => {
      const { addSkills, store, root } = await newUseCase();
      const first = sourceAt(writeSkillDirectory(join(root, 'dev', 'a', 'triage')));
      const second = sourceAt(writeSkillDirectory(join(root, 'dev', 'b', 'triage')));

      const report = addSkills({ sources: [first, second] });

      expect(report.added).toEqual([{ skill: 'triage', storePath: join(store.paths.skills, 'triage') }]);
      expect(report.present).toEqual([{ skill: 'triage' }]);
    });

    it('adds the first and declines the second against what the first just wrote', async () => {
      const { addSkills, store, root } = await newUseCase();
      const first = sourceAt(
        writeSkillDirectory(join(root, 'dev', 'a', 'triage'), { [SKILL_MANIFEST]: 'a' }),
      );
      const second = sourceAt(
        writeSkillDirectory(join(root, 'dev', 'b', 'triage'), { [SKILL_MANIFEST]: 'b' }),
      );

      const report = addSkills({ sources: [first, second] });

      expect(report.added).toEqual([{ skill: 'triage', storePath: join(store.paths.skills, 'triage') }]);
      expect(report.declined).toEqual([
        {
          kind: 'differs',
          skill: 'triage',
          storePath: join(store.paths.skills, 'triage'),
          entry: SKILL_MANIFEST,
        },
      ]);
    });
  });

  describe('what throws and what does not', () => {
    it('returns a report rather than throwing when something was added and something declined', async () => {
      const { addSkills, store, source, storeSkill } = await newUseCase();

      const brainstorm = source('brainstorm');
      storeSkill('triage', { [SKILL_MANIFEST]: 'store version' });
      const triage = source('triage', { [SKILL_MANIFEST]: 'source version' });

      const report = addSkills({ sources: [brainstorm, triage] });

      expect(report.added).toEqual([
        { skill: 'brainstorm', storePath: join(store.paths.skills, 'brainstorm') },
      ]);
      expect(report.declined).toHaveLength(1);
    });

    it('returns a report rather than throwing when something was present and something declined', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm');
      const brainstorm = source('brainstorm');
      storeSkill('triage', { [SKILL_MANIFEST]: 'store version' });
      const triage = source('triage', { [SKILL_MANIFEST]: 'source version' });

      const report = addSkills({ sources: [brainstorm, triage] });

      expect(report.present).toEqual([{ skill: 'brainstorm' }]);
      expect(report.declined).toHaveLength(1);
    });

    it('throws AddDeclinedError when every source was declined, in source order', async () => {
      const { addSkills, source, storeSkill } = await newUseCase();

      storeSkill('brainstorm', { [SKILL_MANIFEST]: 'store version' });
      const brainstorm = source('brainstorm', { [SKILL_MANIFEST]: 'source version' });
      storeSkill('triage', { [SKILL_MANIFEST]: 'other store version' });
      const triage = source('triage', { [SKILL_MANIFEST]: 'other source version' });

      const error = refusal(() => addSkills({ sources: [brainstorm, triage] }));

      expect(error).toBeInstanceOf(AddDeclinedError);
      expect((error as AddDeclinedError).refusals.map((r) => r.skill)).toEqual(['brainstorm', 'triage']);
    });

    it('returns an empty report for an empty sources array', async () => {
      const { addSkills } = await newUseCase();

      expect(addSkills({ sources: [] })).toEqual({ added: [], present: [], declined: [] });
    });

    it('throws InvalidPathError for a source deleted after selection', async () => {
      const { addSkills, source } = await newUseCase();
      const vanished = source('vanished');

      rmSync(vanished.path, { recursive: true });

      expect(refusal(() => addSkills({ sources: [vanished] }))).toBeInstanceOf(InvalidPathError);
    });
  });
});

// ----------------------------------------------------------------------------
// TEST HELPERS
// ----------------------------------------------------------------------------

async function newUseCase() {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));
  const manager = new GrimoireStoreManager(store);

  function source(name: string, files: Record<string, string | Buffer> = {}): SkillSource {
    const path = writeSkillDirectory(join(root, 'dev', name), files);
    return { name, path, location: path };
  }

  function storeSkill(name: string, files: Record<string, string | Buffer> = {}): string {
    return writeSkillDirectory(join(store.paths.skills, name), files);
  }

  return {
    addSkills: createAddSkillsUseCase({ storeManager: manager }),
    manager,
    store,
    root,
    source,
    storeSkill,
  };
}

function sourceAt(path: string): SkillSource {
  return { name: 'triage', path, location: path };
}

/** A skill directory, whose manifest and nested entries any entry in `files` may override. */
function writeSkillDirectory(path: string, files: Record<string, string | Buffer> = {}): string {
  const contents = { [SKILL_MANIFEST]: '# skill\n', ...files };

  for (const [name, content] of Object.entries(contents)) {
    const filePath = join(path, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }

  return path;
}

/** The error a refusal threw, so its whole shape can be asserted on. */
function refusal(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}
