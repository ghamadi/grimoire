import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store';
import { SKILL_MANIFEST } from '@/domains/skill';
import {
  EntityNotFoundError,
  ExportDeclinedError,
  InvalidPathError,
  UnportableSkillError,
} from '@/lib/errors';
import { tempGitRepo } from '@test-helpers/git-repo';
import { runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';
import { createExportSkillsUseCase } from '@/use-cases/export-skills-use-case/factory';

describe('export-skills-use-case factory', () => {
  describe('the preflight', () => {
    it('throws on an unregistered repo, touching nothing', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      storeSkill(store, 'triage');

      const error = refusal(() => exportSkills({ repoName: 'ghost', skillNames: ['triage'] }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entity).toBe('repo');
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('throws on a skill the store does not hold, touching nothing', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      storeSkill(store, 'triage');

      const error = refusal(() =>
        exportSkills({ repoName: 'library', skillNames: ['triage', 'ghost'] }),
      );

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entity).toBe('skill');
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('reports the repo when both the repo and a skill are unknown', async () => {
      const { exportSkills, repo } = await newUseCase();

      const error = refusal(() => exportSkills({ repoName: 'ghost', skillNames: ['phantom'] }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entity).toBe('repo');
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('reports an unknown skill named after an unportable one', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      mkdirSync(join(store.paths.skills, 'broken'), { recursive: true });

      const error = refusal(() =>
        exportSkills({ repoName: 'library', skillNames: ['broken', 'ghost'] }),
      );

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entryName).toBe('ghost');
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it.each([{ force: false }, { force: true }])(
      'throws on a skill that cannot travel, touching nothing (force: $force)',
      async ({ force }) => {
        const { exportSkills, store, repo } = await newUseCase();

        storeSkill(store, 'triage');
        mkdirSync(join(store.paths.skills, 'broken'), { recursive: true });

        const error = refusal(() =>
          exportSkills({ repoName: 'library', skillNames: ['triage', 'broken'], force }),
        );

        expect(error).toBeInstanceOf(UnportableSkillError);
        expect(readdirSync(repo.path)).toEqual(['.git']);
      },
    );

    it('reads a repo directory deleted after registration as missing, not as outside a work tree', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      storeSkill(store, 'triage');
      rmSync(repo.path, { recursive: true });

      const error = refusal(() => exportSkills({ repoName: 'library', skillNames: ['triage'] }));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect((error as InvalidPathError).reason).toBe('missing');
      expect(existsSync(repo.path)).toBe(false);
    });

    it('throws on a repo path that is now a file', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      storeSkill(store, 'triage');
      rmSync(repo.path, { recursive: true });
      writeFileSync(repo.path, 'mine', 'utf8');

      const error = refusal(() => exportSkills({ repoName: 'library', skillNames: ['triage'] }));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect((error as InvalidPathError).reason).toBe('not-a-directory');
      expect(readFileSync(repo.path, 'utf8')).toBe('mine');
    });

    it('throws on a repo path that is no longer inside a git work tree', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      storeSkill(store, 'triage');
      rmSync(join(repo.path, '.git'), { recursive: true });

      const error = refusal(() => exportSkills({ repoName: 'library', skillNames: ['triage'] }));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect((error as InvalidPathError).reason).toBe('not-in-git-work-tree');
      expect(readdirSync(repo.path)).toEqual([]);
    });
  });

  describe('outcomes', () => {
    it('exports into an empty destination, verbatim', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage', { '.hidden': 'dotfile', 'references/notes.md': 'deep notes' });

      const report = exportSkills({ repoName: 'library', skillNames: ['triage'] });

      expect(report).toEqual({
        exported: [{ skill: 'triage', repo: 'library' }],
        declined: [],
        failed: [],
      });
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
      expect(readFileSync(join(dest, '.hidden'), 'utf8')).toBe('dotfile');
      expect(readFileSync(join(dest, 'references', 'notes.md'), 'utf8')).toBe('deep notes');
    });

    it('leaves no staging directory behind after a clean run', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      storeSkill(store, 'triage');
      exportSkills({ repoName: 'library', skillNames: ['triage'] });

      expect(existsSync(stagingPath(repo.path))).toBe(false);
    });

    it('replaces a committed skill directory without force', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'old', 'old.md': 'old' });
      repo.commitAll();

      const report = exportSkills({ repoName: 'library', skillNames: ['triage'] });

      expect(report.exported).toEqual([{ skill: 'triage', repo: 'library' }]);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
      expect(existsSync(join(dest, 'old.md'))).toBe(false);
    });

    it('replaces a committed directory that is not a skill without force', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage');
      mkdirSync(dest);
      writeFileSync(join(dest, 'notes.md'), 'notes', 'utf8');
      repo.commitAll();

      const report = exportSkills({ repoName: 'library', skillNames: ['triage'] });

      expect(report.exported).toEqual([{ skill: 'triage', repo: 'library' }]);
      expect(readdirSync(dest)).toEqual([SKILL_MANIFEST]);
    });

    it('replaces a committed file without force', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage');
      writeFileSync(dest, 'a file', 'utf8');
      repo.commitAll();

      const report = exportSkills({ repoName: 'library', skillNames: ['triage'] });

      expect(report.exported).toEqual([{ skill: 'triage', repo: 'library' }]);
      expect(lstatSync(dest).isDirectory()).toBe(true);
      expect(readdirSync(dest)).toEqual([SKILL_MANIFEST]);
    });

    it('replaces a committed directory holding an ignored file, deleting the ignored file', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage');
      writeFileSync(join(repo.path, '.gitignore'), '*.log\n', 'utf8');
      writeSkillDirectory(dest, { 'debug.log': 'ignored' });
      repo.commitAll();

      const report = exportSkills({ repoName: 'library', skillNames: ['triage'] });

      expect(report.exported).toEqual([{ skill: 'triage', repo: 'library' }]);
      expect(existsSync(join(dest, 'debug.log'))).toBe(false);
    });

    it.each([
      {
        change: 'modified',
        apply: (dest: string) => writeFileSync(join(dest, 'notes.md'), 'edited', 'utf8'),
      },
      {
        change: 'staged',
        apply: (dest: string) => {
          writeFileSync(join(dest, 'notes.md'), 'edited', 'utf8');
          git(dirname(dest), 'add', '--', 'triage/notes.md');
        },
      },
      {
        change: 'deleted',
        apply: (dest: string) => rmSync(join(dest, 'notes.md')),
      },
      {
        change: 'untracked',
        apply: (dest: string) => writeFileSync(join(dest, 'new.md'), 'new', 'utf8'),
      },
    ])('declines a destination holding a $change file, leaving it alone', async ({ apply }) => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage');
      storeSkill(store, 'review');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'old', 'notes.md': 'notes' });
      repo.commitAll();
      apply(dest);

      const report = exportSkills({ repoName: 'library', skillNames: ['triage', 'review'] });

      expect(report.declined).toEqual([{ skill: 'triage', repo: 'library', path: dest }]);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('old');
    });

    it('declines a destination the repo holds under another case, leaving its uncommitted change alone', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const held = join(repo.path, 'Triage');

      storeSkill(store, 'triage');
      writeSkillDirectory(held, { 'notes.md': 'notes' });
      repo.commitAll();
      writeFileSync(join(held, 'notes.md'), 'edited', 'utf8');

      const error = refusal(() => exportSkills({ repoName: 'library', skillNames: ['triage'] }));

      expect(error).toBeInstanceOf(ExportDeclinedError);
      expect(readFileSync(join(held, 'notes.md'), 'utf8')).toBe('edited');
    });

    it('declines a re-export before the first is committed, and exports it under force', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage');
      exportSkills({ repoName: 'library', skillNames: ['triage'] });

      const error = refusal(() => exportSkills({ repoName: 'library', skillNames: ['triage'] }));

      expect(error).toBeInstanceOf(ExportDeclinedError);
      expect((error as ExportDeclinedError).refusals).toEqual([
        { skill: 'triage', repo: 'library', path: dest },
      ]);
      expect(
        exportSkills({ repoName: 'library', skillNames: ['triage'], force: true }).exported,
      ).toEqual([{ skill: 'triage', repo: 'library' }]);
    });

    it('replaces modified content under force', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage');
      writeSkillDirectory(dest, { 'notes.md': 'notes' });
      repo.commitAll();
      writeFileSync(join(dest, 'notes.md'), 'edited', 'utf8');

      const report = exportSkills({ repoName: 'library', skillNames: ['triage'], force: true });

      expect(report.exported).toEqual([{ skill: 'triage', repo: 'library' }]);
      expect(readdirSync(dest)).toEqual([SKILL_MANIFEST]);
    });

    it('exports a skill named twice once', async () => {
      const { exportSkills, store } = await newUseCase();

      storeSkill(store, 'triage');
      storeSkill(store, 'review');

      const report = exportSkills({
        repoName: 'library',
        skillNames: ['triage', 'review', 'triage'],
      });

      expect(report.exported).toEqual([
        { skill: 'triage', repo: 'library' },
        { skill: 'review', repo: 'library' },
      ]);
      expect(report.declined).toEqual([]);
    });

    it('returns a decline beside an export rather than throwing', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      storeSkill(store, 'triage');
      storeSkill(store, 'review');
      exportSkills({ repoName: 'library', skillNames: ['triage'] });

      const report = exportSkills({ repoName: 'library', skillNames: ['triage', 'review'] });

      expect(report).toEqual({
        exported: [{ skill: 'review', repo: 'library' }],
        declined: [{ skill: 'triage', repo: 'library', path: join(repo.path, 'triage') }],
        failed: [],
      });
    });

    it('throws when every skill is declined', async () => {
      const { exportSkills, store, repo } = await newUseCase();

      storeSkill(store, 'triage');
      storeSkill(store, 'review');
      exportSkills({ repoName: 'library', skillNames: ['triage', 'review'] });

      const error = refusal(() =>
        exportSkills({ repoName: 'library', skillNames: ['triage', 'review'] }),
      );

      expect(error).toBeInstanceOf(ExportDeclinedError);
      expect((error as ExportDeclinedError).refusals).toEqual([
        { skill: 'triage', repo: 'library', path: join(repo.path, 'triage') },
        { skill: 'review', repo: 'library', path: join(repo.path, 'review') },
      ]);
    });

    it('fails every skill when .grimoire-staging is a file, throwing nothing', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const staging = stagingPath(repo.path);

      storeSkill(store, 'triage');
      storeSkill(store, 'review');
      writeFileSync(staging, 'mine', 'utf8');

      const report = exportSkills({ repoName: 'library', skillNames: ['triage', 'review'] });

      expect(report.exported).toEqual([]);
      expect(report.failed).toEqual([
        {
          skill: 'triage',
          repo: 'library',
          path: join(repo.path, 'triage'),
          error: expect.objectContaining({ reason: 'not-a-directory' }) as unknown,
        },
        {
          skill: 'review',
          repo: 'library',
          path: join(repo.path, 'review'),
          error: expect.objectContaining({ reason: 'not-a-directory' }) as unknown,
        },
      ]);
      expect(readFileSync(staging, 'utf8')).toBe('mine');
    });

    it('returns a decline beside a failure rather than throwing', async () => {
      const { exportSkills, store, repo } = await newUseCase();
      const dest = join(repo.path, 'triage');

      storeSkill(store, 'triage');
      storeSkill(store, 'review');
      writeSkillDirectory(dest, { 'notes.md': 'mine' });
      writeFileSync(stagingPath(repo.path), 'mine', 'utf8');

      const report = exportSkills({ repoName: 'library', skillNames: ['triage', 'review'] });

      expect(report).toEqual({
        exported: [],
        declined: [{ skill: 'triage', repo: 'library', path: dest }],
        failed: [
          {
            skill: 'review',
            repo: 'library',
            path: join(repo.path, 'review'),
            error: expect.objectContaining({ reason: 'not-a-directory' }) as unknown,
          },
        ],
      });
    });

    describe.skipIf(runsAsRoot)('a copy that fails', () => {
      it('fails that skill and still exports a later one, throwing nothing', async () => {
        const { exportSkills, store, repo } = await newUseCase();
        const unreadable = join(storeSkill(store, 'triage', { 'secret.md': 'secret' }), 'secret.md');

        storeSkill(store, 'review');
        chmodSync(unreadable, 0o000);
        onTestFinished(() => chmodSync(unreadable, 0o644));

        const report = exportSkills({ repoName: 'library', skillNames: ['triage', 'review'] });

        expect(report.exported).toEqual([{ skill: 'review', repo: 'library' }]);
        expect(report.failed).toEqual([
          {
            skill: 'triage',
            repo: 'library',
            path: join(repo.path, 'triage'),
            error: expect.objectContaining({ code: 'EACCES' }) as unknown,
          },
        ]);
        expect(existsSync(join(repo.path, 'triage'))).toBe(false);
        expect(existsSync(stagingPath(repo.path))).toBe(false);
      });
    });

    describe.skipIf(runsAsRoot)('a replaced directory that cannot be deleted', () => {
      it('counts the skill as exported, naming the partly deleted old copy', async () => {
        const { exportSkills, store, repo } = await newUseCase();
        const dest = join(repo.path, 'triage');
        const staging = stagingPath(repo.path);

        storeSkill(store, 'triage');
        writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'old', 'readonly/old.md': 'old' });
        repo.commitAll();
        chmodSync(join(dest, 'readonly'), 0o555);

        // Not `lockDirectory`: the directory is moved into staging before the
        // delete fails, so the path it would restore no longer exists.
        onTestFinished(() => {
          for (const entry of readdirSync(staging)) {
            chmodSync(join(staging, entry, 'readonly'), 0o755);
          }
        });

        const report = exportSkills({ repoName: 'library', skillNames: ['triage'] });
        const [entry] = readdirSync(staging);

        expect(report.failed).toEqual([]);
        expect(report.exported).toEqual([
          {
            skill: 'triage',
            repo: 'library',
            strandedOldEntry: {
              path: join(staging, entry!),
              error: expect.any(Error) as unknown,
            },
          },
        ]);
        expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
        expect(existsSync(join(dest, 'readonly'))).toBe(false);
      });
    });
  });
});

// ----------------------------------------------------------------------------
// TEST HELPERS
// ----------------------------------------------------------------------------

/** A store, and an empty git repository registered in it as `library`. */
async function newUseCase() {
  const store = new GrimoireStore(join(await tempRoot(), '.grimoire'));
  const manager = new GrimoireStoreManager(store);
  const { path, commitAll } = await tempGitRepo();
  const registered = manager.registerRepo({ name: 'library', path });

  return {
    exportSkills: createExportSkillsUseCase({ storeManager: manager }),
    store,
    repo: { path: registered.path, commitAll },
  };
}

function git(repoPath: string, ...args: string[]): void {
  execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' });
}

/** A skill directory, whose manifest any entry in `files` may override. */
function writeSkillDirectory(path: string, files: Record<string, string> = {}): string {
  mkdirSync(path, { recursive: true });

  for (const [name, content] of Object.entries({ [SKILL_MANIFEST]: '# skill\n', ...files })) {
    const filePath = join(path, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }

  return path;
}

function stagingPath(repoPath: string): string {
  return join(repoPath, '.grimoire-staging');
}

function storeSkill(store: GrimoireStore, name: string, files: Record<string, string> = {}): string {
  return writeSkillDirectory(join(store.paths.skills, name), files);
}

/** The error a refusal threw, so its whole message can be asserted on. */
function refusal(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}
