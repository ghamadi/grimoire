import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cloneTrashLabel,
  GrimoireStore,
  GrimoireStoreManager,
} from '#src/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '#src/domains/skill/index';
import { EntityNotFoundError, WorkspaceUnreadableError } from '#src/lib/errors/index';
import { tempRoot } from '#test-helpers/temp-root';
import { createRemoveSkillsUseCase, type RemovedSkill } from '../factory.ts';

describe('remove-skills-use-case factory', () => {
  // Both refusals come before anything is touched, so each of them is run with
  // the other precondition holding — otherwise the assertions that nothing
  // moved would pass on a run that never got that far.
  describe('the preflight', () => {
    it('throws on a skill the store does not hold, removing nothing', async () => {
      const { removeSkills, store, workspace, storeSkill, link } = await newUseCase();

      workspace('work');
      storeSkill('triage');
      const linkPath = link({ workspace: 'work', skill: 'triage' });

      expect(refusal(() => removeSkills({ skillNames: ['ghost'] }))).toBeInstanceOf(
        EntityNotFoundError,
      );
      expect(existsSync(join(store.paths.skills, 'triage'))).toBe(true);
      expect(existsSync(linkPath)).toBe(true);
      expect(readdirSync(store.paths.trash)).toEqual([]);
    });

    it('names the first unknown of two', async () => {
      const { removeSkills } = await newUseCase();

      expect(refusal(() => removeSkills({ skillNames: ['ghost', 'phantom'] })).message).toContain(
        'ghost',
      );
    });

    it('throws on a registered workspace whose path no longer resolves', async () => {
      const { removeSkills, store, workspace, storeSkill, link } = await newUseCase();

      workspace('work');
      storeSkill('triage');
      const linkPath = link({ workspace: 'work', skill: 'triage' });
      const gonePath = workspace('gone');

      rmSync(gonePath, { recursive: true });

      const error = refusal(() => removeSkills({ skillNames: ['triage'] }));

      expect(error).toBeInstanceOf(WorkspaceUnreadableError);
      expect((error as WorkspaceUnreadableError).workspaces).toEqual([
        { name: 'gone', path: gonePath },
      ]);
      expect(existsSync(join(store.paths.skills, 'triage'))).toBe(true);
      expect(existsSync(linkPath)).toBe(true);
      expect(readdirSync(store.paths.trash)).toEqual([]);
    });

    it('carries every unreadable workspace, in registry order', async () => {
      const { removeSkills, workspace, storeSkill } = await newUseCase();

      storeSkill('triage');
      const buried = workspace('buried');
      const gone = workspace('gone');

      rmSync(buried, { recursive: true });
      writeFileSync(buried, '', 'utf8');
      rmSync(gone, { recursive: true });

      const error = refusal(() => removeSkills({ skillNames: ['triage'] }));

      expect((error as WorkspaceUnreadableError).workspaces).toEqual([
        { name: 'buried', path: buried },
        { name: 'gone', path: gone },
      ]);
    });
  });

  // Which skill a link belongs to is what it resolves into, never what the
  // entry is called.
  describe('the links it clears', () => {
    it('clears a link named for its skill, reporting it without an entry', async () => {
      const { removeSkills, workspace, storeSkill, link } = await newUseCase();

      workspace('work');
      storeSkill('triage');
      const linkPath = link({ workspace: 'work', skill: 'triage' });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(removed.clearedLinks).toEqual([{ skill: 'triage', workspace: 'work' }]);
      expect(existsSync(linkPath)).toBe(false);
    });

    it('clears a renamed entry, reporting the name it was filed under', async () => {
      const { removeSkills, workspace, storeSkill, link } = await newUseCase();

      workspace('work');
      storeSkill('triage');
      const linkPath = link({ workspace: 'work', skill: 'triage', entry: 'tri' });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(removed.clearedLinks).toEqual([{ skill: 'triage', workspace: 'work', filedAs: 'tri' }]);
      expect(existsSync(linkPath)).toBe(false);
    });

    it('leaves an entry named for the skill that resolves into another one', async () => {
      const { removeSkills, workspace, storeSkill, link } = await newUseCase();

      workspace('work');
      storeSkill('triage');
      storeSkill('other');
      const linkPath = link({ workspace: 'work', skill: 'other', entry: 'triage' });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(removed.clearedLinks).toEqual([]);
      expect(existsSync(linkPath)).toBe(true);
    });

    it('leaves a symlink pointing outside the store', async () => {
      const { removeSkills, workspace, storeSkill, root } = await newUseCase();

      const work = workspace('work');
      storeSkill('triage');
      const foreign = join(work, 'triage');

      symlinkSync(writeSkillDirectory(join(root, 'elsewhere', 'triage')), foreign);

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(removed.clearedLinks).toEqual([]);
      expect(existsSync(foreign)).toBe(true);
    });

    it('leaves a directory named for the skill', async () => {
      const { removeSkills, workspace, storeSkill } = await newUseCase();

      const work = workspace('work');
      storeSkill('triage');
      const directory = writeSkillDirectory(join(work, 'triage'));

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(removed.clearedLinks).toEqual([]);
      expect(existsSync(join(directory, SKILL_MANIFEST))).toBe(true);
    });

    it('reports links from two workspaces in workspace-name order', async () => {
      const { removeSkills, workspace, storeSkill, link } = await newUseCase();

      const work = workspace('work');
      const personal = workspace('personal');
      storeSkill('triage');
      link({ workspace: 'work', skill: 'triage' });
      link({ workspace: 'personal', skill: 'triage' });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(removed.clearedLinks).toEqual([
        { skill: 'triage', workspace: 'personal' },
        { skill: 'triage', workspace: 'work' },
      ]);
      expect(existsSync(work)).toBe(true);
      expect(existsSync(personal)).toBe(true);
    });
  });


  describe('the store copy it trashes', () => {
    it('moves it into a bin named for the skill and the moment', async () => {
      const { removeSkills, store, storeSkill } = await newUseCase();

      storeSkill('triage', { [SKILL_MANIFEST]: '# triage\n' });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(removed.binPath).toBe(join(store.paths.trash, 'triage-20260915T124530'));
      expect(readFileSync(join(removed.binPath, 'store', SKILL_MANIFEST), 'utf8')).toBe('# triage\n');
      expect(existsSync(join(store.paths.skills, 'triage'))).toBe(false);
    });

    // Trash first and the link is stranded: its target has moved into `.trash/`,
    // so `findStoreLinks` no longer reads it as one of the store's.
    it('clears the links before the copy moves out from under them', async () => {
      const { removeSkills, workspace, storeSkill, link } = await newUseCase();

      workspace('work');
      storeSkill('triage');
      const linkPath = link({ workspace: 'work', skill: 'triage' });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(existsSync(linkPath)).toBe(false);
      expect(existsSync(join(removed.binPath, 'store', SKILL_MANIFEST))).toBe(true);
    });
  });


  describe('the clones it keeps', () => {
    it('reports every recorded clone and leaves all of them alone', async () => {
      const { removeSkills, store, root, workspace, storeSkill, cloneDirectory, recordClone } =
        await newUseCase();

      const work = workspace('work');
      storeSkill('triage');

      const inWorkspace = cloneDirectory(join(work, 'triage'));
      const byPath = cloneDirectory(join(root, 'dev', 'triage'));

      recordClone('triage', { workspace: 'work' });
      recordClone('triage', { path: join(root, 'dev') });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'] }));

      expect(removed.keptClones).toEqual(['work', join(root, 'dev')]);
      expect(removed.removedClones).toEqual([]);
      expect(existsSync(join(inWorkspace, SKILL_MANIFEST))).toBe(true);
      expect(existsSync(join(byPath, SKILL_MANIFEST))).toBe(true);
      expect(readdirSync(removed.binPath)).toEqual(['store']);
      expect(readState(store).skills?.['triage']?.clones).toEqual([
        { workspace: 'work' },
        { path: join(root, 'dev') },
      ]);
    });
  });


  describe('the clones it removes', () => {
    it('moves each one into the bin under the name its record gives it', async () => {
      const { removeSkills, root, workspace, storeSkill, cloneDirectory, recordClone } =
        await newUseCase();

      const work = workspace('work');
      storeSkill('triage');

      cloneDirectory(join(work, 'triage'));
      cloneDirectory(join(root, 'dev', 'triage'));

      recordClone('triage', { workspace: 'work' });
      recordClone('triage', { path: join(root, 'dev') });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'], removeClones: true }));
      const byPathLabel = cloneTrashLabel({ path: join(root, 'dev') });

      expect(readFileSync(join(removed.binPath, 'clones', 'work', SKILL_MANIFEST), 'utf8')).toBe(
        '# skill\n',
      );
      expect(
        readFileSync(join(removed.binPath, 'clones', byPathLabel, SKILL_MANIFEST), 'utf8'),
      ).toBe('# skill\n');
      expect(existsSync(join(work, 'triage'))).toBe(false);
      expect(existsSync(join(root, 'dev', 'triage'))).toBe(false);
      expect(removed.removedClones).toEqual(['work', join(root, 'dev')]);
      expect(removed.keptClones).toEqual([]);
    });

    it('forgets the skill, leaving every other skill recorded', async () => {
      const { removeSkills, store, workspace, storeSkill, cloneDirectory, recordClone } =
        await newUseCase();

      const work = workspace('work');
      storeSkill('triage');
      storeSkill('other');

      cloneDirectory(join(work, 'triage'));
      recordClone('triage', { workspace: 'work' });
      recordClone('other', { workspace: 'work' });

      removeSkills({ skillNames: ['triage'], removeClones: true });

      expect(readState(store).skills).toEqual({ other: { clones: [{ workspace: 'work' }] } });
    });

    // `trashSkill` answers with the bin and nothing else, so a clone that was
    // already gone cannot be told from one it moved. Reported either way: the
    // record named that directory, and the record is being forgotten.
    it('reports a clone whose directory was already deleted', async () => {
      const { removeSkills, workspace, storeSkill, cloneDirectory, recordClone } =
        await newUseCase();

      const work = workspace('work');
      storeSkill('triage');

      rmSync(cloneDirectory(join(work, 'triage')), { recursive: true });
      recordClone('triage', { workspace: 'work' });

      const removed = onlyRemoval(removeSkills({ skillNames: ['triage'], removeClones: true }));

      expect(removed.removedClones).toEqual(['work']);
      expect(existsSync(join(removed.binPath, 'clones'))).toBe(false);
    });
  });


  describe('the batch', () => {
    it('removes every name in argument order, into bins sharing one timestamp', async () => {
      const { removeSkills, store, storeSkill } = await newUseCase();

      storeSkill('triage');
      storeSkill('brainstorm');

      const removed = removeSkills({ skillNames: ['triage', 'brainstorm'] });

      expect(removed.map(({ skill }) => skill)).toEqual(['triage', 'brainstorm']);
      expect(removed.map(({ binPath }) => binPath)).toEqual([
        join(store.paths.trash, 'triage-20260915T124530'),
        join(store.paths.trash, 'brainstorm-20260915T124530'),
      ]);
    });

    // Without the dedupe the second pass meets a store the first already
    // emptied, and throws after the copy has moved.
    it('removes a repeated name once', async () => {
      const { removeSkills, storeSkill } = await newUseCase();

      storeSkill('triage');

      expect(removeSkills({ skillNames: ['triage', 'triage'] }).map(({ skill }) => skill)).toEqual([
        'triage',
      ]);
    });

    it('refuses the whole run over a later unknown name', async () => {
      const { removeSkills, store, storeSkill } = await newUseCase();

      storeSkill('triage');

      expect(refusal(() => removeSkills({ skillNames: ['triage', 'ghost'] }))).toBeInstanceOf(
        EntityNotFoundError,
      );
      expect(existsSync(join(store.paths.skills, 'triage'))).toBe(true);
      expect(readdirSync(store.paths.trash)).toEqual([]);
    });

    it('stamps the bin from the wall clock when none is injected', async () => {
      const { manager, storeSkill } = await newUseCase();

      storeSkill('triage');

      const removed = onlyRemoval(
        createRemoveSkillsUseCase({ storeManager: manager })({ skillNames: ['triage'] }),
      );

      expect(basename(removed.binPath)).toMatch(/^triage-\d{8}T\d{6}$/);
    });
  });

});

// ----------------------------------------------------------------------------
// TEST HELPERS
// ----------------------------------------------------------------------------

/** The clock every run is pinned to, giving `triage-20260915T124530`. */
const NOW = new Date(2026, 8, 15, 12, 45, 30);

async function newUseCase() {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));
  const manager = new GrimoireStoreManager(store);

  /** A registered workspace, returning the path it was registered at. */
  function workspace(name: string, options: { autoLink?: boolean; path?: string } = {}): string {
    const path = options.path ?? join(root, name);

    if (!options.path) {
      mkdirSync(path, { recursive: true });
    }

    return manager.registerWorkspace({ name, path, autoLink: options.autoLink }).path;
  }

  function storeSkill(name: string, files: Record<string, string> = {}): string {
    return writeSkillDirectory(join(store.paths.skills, name), files);
  }

  /** A symlink into the store, under an entry name that need not be the skill's. */
  function link(params: { workspace: string; skill: string; entry?: string }): string {
    const { path } = manager.requireRegisteredWorkspace(params.workspace);
    const linkPath = join(path, params.entry ?? params.skill);

    symlinkSync(manager.skillPath(params.skill), linkPath);

    return linkPath;
  }

  function cloneDirectory(path: string): string {
    return writeSkillDirectory(path);
  }

  /** A clone record appended past the manager, which has no door for writing one. */
  function recordClone(skill: string, record: CloneRecord): void {
    const state = readState(store);
    const skills = state.skills ?? {};
    const clones = skills[skill]?.clones ?? [];

    mkdirSync(dirname(store.paths.state), { recursive: true });
    writeFileSync(
      store.paths.state,
      JSON.stringify(
        { ...state, skills: { ...skills, [skill]: { clones: [...clones, record] } } },
        null,
        2,
      ),
      'utf8',
    );
  }

  return {
    removeSkills: createRemoveSkillsUseCase({ storeManager: manager, now: () => NOW }),
    manager,
    store,
    root,
    workspace,
    storeSkill,
    link,
    cloneDirectory,
    recordClone,
  };
}

/** A skill directory, whose manifest any entry in `files` may override. */
function writeSkillDirectory(path: string, files: Record<string, string> = {}): string {
  for (const [name, content] of Object.entries({ [SKILL_MANIFEST]: '# skill\n', ...files })) {
    const filePath = join(path, name);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }

  return path;
}

/** The one removal a single-name run reports. */
function onlyRemoval(removals: RemovedSkill[]): RemovedSkill {
  expect(removals).toHaveLength(1);

  return removals[0]!;
}

type CloneRecord = { workspace: string } | { path: string };

type StateDocument = {
  workspaces?: Record<string, { path: string; autoLink: boolean }>;
  skills?: Record<string, { clones: CloneRecord[] }>;
};

/** `state.json` as it sits on disk, or an empty document before anything writes one. */
function readState(store: GrimoireStore): StateDocument {
  return existsSync(store.paths.state)
    ? (JSON.parse(readFileSync(store.paths.state, 'utf8')) as StateDocument)
    : {};
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
