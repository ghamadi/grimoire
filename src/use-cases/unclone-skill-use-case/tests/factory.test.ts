import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store';
import { EntityNotFoundError, GrimoireError } from '@/lib/errors';
import { tempRoot } from '@test-helpers/temp-root';
import { createUncloneSkillUseCase } from '@/use-cases/unclone-skill-use-case/factory';

describe('unclone-skill-use-case factory', () => {
  describe('the records it drops', () => {
    it('drops a { workspace } record for a workspace named as the target', async () => {
      const { uncloneSkill, register, storeSkill, cloneDirectory, recordClones, readClones } =
        await newUseCase();
      const workspace = register('personal');

      storeSkill('triage');

      const clone = cloneDirectory(join(workspace, 'triage'));

      recordClones({ triage: [{ workspace: 'personal' }] });

      const report = uncloneSkill({ skillName: 'triage', targets: ['personal'] });

      expect(report.uncloned).toEqual([{ skill: 'triage', target: 'personal' }]);
      expect(readClones().triage).toEqual([]);
      expect(existsSync(clone)).toBe(true);
    });

    it('drops a { path } record for a path given as the target', async () => {
      const { uncloneSkill, root, storeSkill, cloneDirectory, recordClones, readClones } =
        await newUseCase();
      const directory = join(root, 'old');

      storeSkill('triage');

      const clone = cloneDirectory(join(directory, 'triage'));

      recordClones({ triage: [{ path: directory }] });

      const report = uncloneSkill({ skillName: 'triage', targets: [directory] });

      expect(report.uncloned).toEqual([{ skill: 'triage', target: directory }]);
      expect(readClones().triage).toEqual([]);
      expect(existsSync(clone)).toBe(true);
    });

    // `workspaces remove` leaves { path } records behind for the directories it
    // unregisters, so a name has to reach them through the workspace's path.
    it('drops a { path } record for a workspace named as the target', async () => {
      const { uncloneSkill, register, storeSkill, cloneDirectory, recordClones, readClones } =
        await newUseCase();
      const workspace = register('personal');

      storeSkill('triage');

      const clone = cloneDirectory(join(workspace, 'triage'));

      recordClones({ triage: [{ path: workspace }] });

      const report = uncloneSkill({ skillName: 'triage', targets: ['personal'] });

      expect(report.uncloned).toEqual([{ skill: 'triage', target: 'personal' }]);
      expect(readClones().triage).toEqual([]);
      expect(existsSync(clone)).toBe(true);
    });

    it('drops a { workspace } record for the path of that workspace given as the target', async () => {
      const { uncloneSkill, register, storeSkill, cloneDirectory, recordClones, readClones } =
        await newUseCase();
      const workspace = register('personal');

      storeSkill('triage');

      const clone = cloneDirectory(join(workspace, 'triage'));

      recordClones({ triage: [{ workspace: 'personal' }] });

      const report = uncloneSkill({ skillName: 'triage', targets: [workspace] });

      expect(report.uncloned).toEqual([{ skill: 'triage', target: workspace }]);
      expect(readClones().triage).toEqual([]);
      expect(existsSync(clone)).toBe(true);
    });

    it('drops only the matched record of a skill with two', async () => {
      const { uncloneSkill, register, storeSkill, recordClones, readClones } = await newUseCase();

      register('personal');
      register('work');
      storeSkill('triage');
      recordClones({ triage: [{ workspace: 'personal' }, { workspace: 'work' }] });

      uncloneSkill({ skillName: 'triage', targets: ['personal'] });

      expect(readClones().triage).toEqual([{ workspace: 'work' }]);
    });

    it('leaves the records of other skills untouched', async () => {
      const { uncloneSkill, register, storeSkill, recordClones, readClones } = await newUseCase();

      register('personal');
      storeSkill('triage');
      storeSkill('deploy');
      recordClones({ triage: [{ workspace: 'personal' }], deploy: [{ workspace: 'personal' }] });

      uncloneSkill({ skillName: 'triage', targets: ['personal'] });

      expect(readClones().deploy).toEqual([{ workspace: 'personal' }]);
    });
  });

  describe('the store and the filesystem', () => {
    it('unclones a record whose store skill is gone', async () => {
      const { uncloneSkill, register, recordClones, readClones } = await newUseCase();

      register('personal');
      recordClones({ triage: [{ workspace: 'personal' }] });

      const report = uncloneSkill({ skillName: 'triage', targets: ['personal'] });

      expect(report.uncloned).toEqual([{ skill: 'triage', target: 'personal' }]);
      expect(readClones().triage).toEqual([]);
    });

    it('reports a misspelled skill as not cloned without throwing', async () => {
      const { uncloneSkill, register, storeSkill, recordClones, readClones } = await newUseCase();

      register('personal');
      storeSkill('triage');
      recordClones({ triage: [{ workspace: 'personal' }] });

      const report = uncloneSkill({ skillName: 'triag', targets: ['personal'] });

      expect(report.notCloned).toEqual([{ skill: 'triag', target: 'personal' }]);
      expect(readClones().triage).toEqual([{ workspace: 'personal' }]);
    });

    it('unclones a registered workspace whose directory has been deleted', async () => {
      const { uncloneSkill, register, storeSkill, recordClones, readClones } = await newUseCase();
      const workspace = register('personal');

      storeSkill('triage');
      recordClones({ triage: [{ workspace: 'personal' }] });
      rmSync(workspace, { recursive: true });

      const report = uncloneSkill({ skillName: 'triage', targets: ['personal'] });

      expect(report.uncloned).toEqual([{ skill: 'triage', target: 'personal' }]);
      expect(readClones().triage).toEqual([]);
    });
  });

  describe('what it reports', () => {
    it('reports a registered name with no record as not cloned, as given', async () => {
      const { uncloneSkill, register, storeSkill } = await newUseCase();

      register('personal');
      storeSkill('triage');

      const report = uncloneSkill({ skillName: 'triage', targets: ['personal'] });

      expect(report).toEqual({
        uncloned: [],
        notCloned: [{ skill: 'triage', target: 'personal' }],
      });
    });

    it('reports a path with no record as not cloned, normalized', async () => {
      const { uncloneSkill, root, storeSkill } = await newUseCase();

      storeSkill('triage');

      const report = uncloneSkill({ skillName: 'triage', targets: [`${root}/./old/`] });

      expect(report.notCloned).toEqual([{ skill: 'triage', target: join(root, 'old') }]);
    });

    it('returns uncloned and not cloned targets each in argument order', async () => {
      const { uncloneSkill, register, root, storeSkill, recordClones } = await newUseCase();
      const elsewhere = join(root, 'elsewhere');

      register('personal');
      register('work');
      register('idle');
      storeSkill('triage');
      recordClones({ triage: [{ workspace: 'personal' }, { workspace: 'work' }] });

      const report = uncloneSkill({
        skillName: 'triage',
        targets: ['work', 'idle', elsewhere, 'personal'],
      });

      expect(report.uncloned.map((pair) => pair.target)).toEqual(['work', 'personal']);
      expect(report.notCloned.map((pair) => pair.target)).toEqual(['idle', elsewhere]);
    });

    it('reports a target named twice once', async () => {
      const { uncloneSkill, register, storeSkill, recordClones } = await newUseCase();

      register('personal');
      storeSkill('triage');
      recordClones({ triage: [{ workspace: 'personal' }] });

      const report = uncloneSkill({ skillName: 'triage', targets: ['personal', 'personal'] });

      expect(report).toEqual({
        uncloned: [{ skill: 'triage', target: 'personal' }],
        notCloned: [],
      });
    });

    // Deduping the raw argument would let both spellings through, and the second
    // would report `not cloned` for the directory the first had just forgotten.
    it('reports two spellings of one directory once', async () => {
      const { uncloneSkill, root, storeSkill, recordClones } = await newUseCase();
      const directory = join(root, 'old');

      storeSkill('triage');
      recordClones({ triage: [{ path: directory }] });

      const report = uncloneSkill({
        skillName: 'triage',
        targets: [`${directory}/`, `${root}/./old`],
      });

      expect(report).toEqual({
        uncloned: [{ skill: 'triage', target: directory }],
        notCloned: [],
      });
    });

    it('reads a bare ~ as a path rather than a workspace name', async () => {
      const { uncloneSkill, storeSkill } = await newUseCase();

      storeSkill('triage');

      const report = uncloneSkill({ skillName: 'triage', targets: ['~'] });

      expect(report.notCloned).toEqual([{ skill: 'triage', target: homedir() }]);
    });

    it('returns an empty report for an empty target list', async () => {
      const { uncloneSkill, storeSkill } = await newUseCase();

      storeSkill('triage');

      expect(uncloneSkill({ skillName: 'triage', targets: [] })).toEqual({
        uncloned: [],
        notCloned: [],
      });
    });
  });

  describe('an unregistered workspace name', () => {
    it('refuses without dropping the records of the names before it', async () => {
      const { uncloneSkill, register, storeSkill, recordClones, readClones } = await newUseCase();

      register('personal');
      storeSkill('triage');
      recordClones({ triage: [{ workspace: 'personal' }] });

      const error = refusal(() => uncloneSkill({ skillName: 'triage', targets: ['personal', 'ghost'] }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(readClones().triage).toEqual([{ workspace: 'personal' }]);
    });

    it('refuses without dropping the record of a path target before it', async () => {
      const { uncloneSkill, root, storeSkill, recordClones, readClones } = await newUseCase();
      const directory = join(root, 'old');

      storeSkill('triage');
      recordClones({ triage: [{ path: directory }] });

      const error = refusal(() => uncloneSkill({ skillName: 'triage', targets: [directory, 'ghost'] }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(readClones().triage).toEqual([{ path: directory }]);
    });

    it('refuses when it is the only target', async () => {
      const { uncloneSkill, storeSkill } = await newUseCase();

      storeSkill('triage');

      expect(refusal(() => uncloneSkill({ skillName: 'triage', targets: ['ghost'] }))).toBeInstanceOf(
        EntityNotFoundError,
      );
    });
  });
});

type CloneRecord = { workspace: string } | { path: string };

/** state.json as it sits on disk, carrying only the sections these tests touch. */
type StoredDocument = {
  skills?: Record<string, { clones: CloneRecord[] }>;
};

async function newUseCase() {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));
  const manager = new GrimoireStoreManager(store);

  /** Registers a workspace over a directory of the same name, and returns its path. */
  function register(name: string): string {
    const path = join(root, name);

    mkdirSync(path, { recursive: true });
    manager.registerWorkspace({ name, path });

    return path;
  }

  /** Puts a skill in the store. */
  function storeSkill(name: string): void {
    const directory = join(store.paths.skills, name);

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'SKILL.md'), `# ${name}\n`, 'utf8');
  }

  /** Creates a cloned skill's directory, and returns its path. */
  function cloneDirectory(path: string): string {
    mkdirSync(path, { recursive: true });

    return path;
  }

  /** Clone records as state.json holds them, keyed by skill — `{ path }` records have no writer. */
  function recordClones(clonesBySkill: Record<string, CloneRecord[]>): void {
    mkdirSync(store.paths.root, { recursive: true });

    const skills = Object.fromEntries(
      Object.entries(clonesBySkill).map(([skill, clones]) => [skill, { clones }]),
    );

    writeFileSync(store.paths.state, JSON.stringify({ ...readDocument(), skills }), 'utf8');
  }

  /** The same records read back off disk, keyed by skill. */
  function readClones(): Record<string, CloneRecord[]> {
    const { skills = {} } = readDocument();

    return Object.fromEntries(Object.entries(skills).map(([skill, { clones }]) => [skill, clones]));
  }

  function readDocument(): StoredDocument {
    return existsSync(store.paths.state)
      ? (JSON.parse(readFileSync(store.paths.state, 'utf8')) as StoredDocument)
      : {};
  }

  return {
    uncloneSkill: createUncloneSkillUseCase({ storeManager: manager }),
    register,
    storeSkill,
    cloneDirectory,
    recordClones,
    readClones,
    root,
  };
}

/** A GrimoireError is what keeps cli.ts from printing a stack trace. */
function refusal(run: () => unknown): GrimoireError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GrimoireError);

    return error as GrimoireError;
  }

  expect.fail('expected a refusal');
}
