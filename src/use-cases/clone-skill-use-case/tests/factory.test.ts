import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '#src/domains/skill/index';
import { CloneDeclinedError, EntityNotFoundError, UnportableSkillError } from '#src/lib/errors/index';
import { lockDirectory, runsAsRoot } from '#test-helpers/locked-directory';
import { tempRoot } from '#test-helpers/temp-root';
import { createCloneSkillUseCase } from '../factory.ts';

describe('clone-skill-use-case factory', () => {
  describe('the preflight', () => {
    it('throws on a skill the store does not hold, touching nothing', async () => {
      const { cloneSkill, workspace } = await newUseCase();
      const personal = workspace('personal');

      expect(refusal(() => cloneSkill({ skillName: 'ghost', workspaces: ['personal'] }))).toBeInstanceOf(
        EntityNotFoundError,
      );
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('throws on a store directory holding no SKILL.md', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      mkdirSync(join(store.paths.skills, 'brainstorm'), { recursive: true });

      expect(
        refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] })),
      ).toBeInstanceOf(UnportableSkillError);
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('throws on an unregistered workspace name, touching nothing', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');

      expect(
        refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['ghost'] })),
      ).toBeInstanceOf(EntityNotFoundError);
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('carries the first of two unknown workspace names', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();

      workspace('second');
      storeSkill(store, 'brainstorm');

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['first', 'second'] }),
      );

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entryName).toBe('first');
    });

    it('throws for the skill when both a ghost skill and a ghost workspace are named', async () => {
      const { cloneSkill, workspace } = await newUseCase();
      const personal = workspace('personal');

      const error = refusal(() => cloneSkill({ skillName: 'ghost', workspaces: ['ghost-workspace'] }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entity).toBe('skill');
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('throws UnportableSkillError beside a ghost workspace, before the workspace name is checked', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      mkdirSync(join(store.paths.skills, 'brainstorm'), { recursive: true });

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['ghost-workspace'] }),
      );

      expect(error).toBeInstanceOf(UnportableSkillError);
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });
  });

  describe('what it copies', () => {
    it('copies an empty destination verbatim and records the clone', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm', { 'references/notes.md': 'deep notes' });

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.cloned).toEqual([
        { skill: 'brainstorm', workspace: 'personal', replacedLink: false },
      ]);
      expect(readFileSync(join(personal, 'brainstorm', 'references', 'notes.md'), 'utf8')).toBe(
        'deep notes',
      );
      expect(manager.listSkillClones('brainstorm')).toEqual([
        { origin: 'personal', path: join(personal, 'brainstorm'), record: { workspace: 'personal' } },
      ]);
    });

    it('replaces a symlink into this store skill, marking it replaced', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');
      const skillPath = storeSkill(store, 'brainstorm');

      symlinkSync(skillPath, dest);

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.cloned).toEqual([
        { skill: 'brainstorm', workspace: 'personal', replacedLink: true },
      ]);
      expect(lstatSync(dest).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
      expect(existsSync(join(skillPath, SKILL_MANIFEST))).toBe(true);
    });

    it('declines a symlink into a different store skill, leaving it in place', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      const triagePath = storeSkill(store, 'triage');
      symlinkSync(triagePath, dest);

      const error = refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect(error).toBeInstanceOf(CloneDeclinedError);
      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'foreign-symlink' },
        },
      ]);
      expect(readlinkSync(dest)).toBe(triagePath);
    });

    it('copies before it records the clone', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');

      const record = manager.recordClone.bind(manager);
      const seen: boolean[] = [];
      vi.spyOn(manager, 'recordClone').mockImplementation((params) => {
        seen.push(existsSync(join(dest, SKILL_MANIFEST)));
        record(params);
      });

      cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(seen).toEqual([true]);
      expect(manager.listSkillClones('brainstorm')).toEqual([
        { origin: 'personal', path: dest, record: { workspace: 'personal' } },
      ]);
    });
  });

  describe('the destinations it declines', () => {
    it('declines a plain file at the destination, leaving its content untouched', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeFileSync(dest, 'not a skill', 'utf8');

      const error = refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'not-a-directory' },
        },
      ]);
      expect(readFileSync(dest, 'utf8')).toBe('not a skill');
    });

    // `clone` declines where `link` would have swapped it: identical content is
    // not proof of grimoire's own copy without a record naming it.
    it('declines an unrecorded directory identical to the store copy, leaving it in place', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(dest);

      const error = refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'unrecorded-directory' },
        },
      ]);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
    });

    it('declines a registered directory that is gone, cloning into the rest', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const gone = workspace('personal');
      workspace('work');

      rmSync(gone, { recursive: true });
      storeSkill(store, 'brainstorm');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        { kind: 'workspace-unreachable', skill: 'brainstorm', workspace: 'personal', path: gone },
      ]);
      expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'work', replacedLink: false }]);
    });

    it('declines a registered path that has become a file, cloning into the rest', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const path = workspace('personal');
      workspace('work');

      rmSync(path, { recursive: true });
      writeFileSync(path, '', 'utf8');
      storeSkill(store, 'brainstorm');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        { kind: 'workspace-unreachable', skill: 'brainstorm', workspace: 'personal', path },
      ]);
      expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'work', replacedLink: false }]);
    });

    it('declines a registered path that is a symlink cycle, cloning into the rest', async () => {
      const { cloneSkill, store, workspace, root } = await newUseCase();
      const work = workspace('work');
      const cycle = join(root, 'a');

      symlinkSync(join(root, 'b'), cycle);
      symlinkSync(cycle, join(root, 'b'));
      handEditState(store, {
        personal: { path: cycle, autoLink: false },
        work: { path: work, autoLink: false },
      });
      storeSkill(store, 'brainstorm');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        { kind: 'workspace-unreachable', skill: 'brainstorm', workspace: 'personal', path: cycle },
      ]);
      expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'work', replacedLink: false }]);
    });

    describe.skipIf(runsAsRoot)('a workspace that cannot be read', () => {
      it('declines it rather than throwing, cloning into the rest', async () => {
        const { cloneSkill, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        workspace('work');

        storeSkill(store, 'brainstorm');
        lockDirectory({ path: personal });

        const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

        expect(report.declined).toEqual([
          { kind: 'workspace-unreadable', skill: 'brainstorm', workspace: 'personal', path: personal },
        ]);
        expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'work', replacedLink: false }]);
      });
    });
  });

  describe('recorded destinations', () => {
    it('reports a recorded directory as already cloned without inspecting or refreshing it', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'drifted' });
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.alreadyCloned).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      expect(report.cloned).toEqual([]);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('drifted');
    });

    it('reports already cloned through a sibling workspace registered at the same path', async () => {
      const { cloneSkill, manager, store, root } = await newUseCase();
      const shared = join(root, 'shared');
      mkdirSync(shared, { recursive: true });

      manager.registerWorkspace({ name: 'first', path: shared, autoLink: false });
      manager.registerWorkspace({ name: 'second', path: shared, autoLink: false });

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(join(shared, 'brainstorm'));
      manager.recordClone({ skill: 'brainstorm', workspace: 'first' });

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['second'] });

      expect(report.alreadyCloned).toEqual([{ skill: 'brainstorm', workspace: 'second' }]);
      expect(report.cloned).toEqual([]);
    });

    it('re-copies under a { path } record for a directory the user deleted', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
      manager.recordClonesByPath({ workspace: 'personal', path: personal });
      rmSync(dest, { recursive: true, force: true });

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.cloned).toEqual([
        { skill: 'brainstorm', workspace: 'personal', replacedLink: false },
      ]);
      expect(existsSync(join(dest, SKILL_MANIFEST))).toBe(true);
      expect(manager.listSkillClones('brainstorm')).toEqual([
        { origin: personal, path: dest, record: { path: personal } },
      ]);
    });
  });

  describe('adopting', () => {
    it('records a directory that differs from the store copy without touching either', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');
      const storePath = storeSkill(store, 'triage');

      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'edited' });

      const report = cloneSkill({ skillName: 'triage', workspaces: ['personal'], adopt: true });

      expect(report.adopted).toEqual([{ skill: 'triage', workspace: 'personal' }]);
      expect(report.cloned).toEqual([]);
      expect(report.declined).toEqual([]);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('edited');
      expect(readFileSync(join(storePath, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
      expect(manager.listSkillClones('triage')).toEqual([
        { origin: 'personal', path: dest, record: { workspace: 'personal' } },
      ]);
    });

    it('declines a directory holding no SKILL.md and records nothing', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');

      storeSkill(store, 'triage');
      mkdirSync(dest, { recursive: true });

      const error = refusal(() =>
        cloneSkill({ skillName: 'triage', workspaces: ['personal'], adopt: true }),
      );

      expect(error).toBeInstanceOf(CloneDeclinedError);
      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'triage',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'not-a-skill' },
        },
      ]);
      expect(manager.listSkillClones('triage')).toEqual([]);
    });

    it('reports a recorded directory as already cloned without inspecting its content', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');

      storeSkill(store, 'triage');
      writeSkillDirectory(dest);
      manager.recordClone({ skill: 'triage', workspace: 'personal' });
      rmSync(join(dest, SKILL_MANIFEST));

      const report = cloneSkill({ skillName: 'triage', workspaces: ['personal'], adopt: true });

      expect(report.alreadyCloned).toEqual([{ skill: 'triage', workspace: 'personal' }]);
      expect(report.adopted).toEqual([]);
      expect(report.declined).toEqual([]);
    });
  });

  describe('the batch', () => {
    it('reports two workspaces in argument order', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();

      workspace('work');
      workspace('personal');
      storeSkill(store, 'brainstorm');

      expect(
        cloneSkill({ skillName: 'brainstorm', workspaces: ['work', 'personal'] }).cloned.map(
          ({ workspace: name }) => name,
        ),
      ).toEqual(['work', 'personal']);
    });

    it('clones once for a workspace named twice', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();

      workspace('personal');
      storeSkill(store, 'brainstorm');

      expect(
        cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'personal'] }).cloned,
      ).toEqual([{ skill: 'brainstorm', workspace: 'personal', replacedLink: false }]);
    });

    it('interleaves declined entries in argument order rather than grouping by kind', async () => {
      const { cloneSkill, store, workspace, root } = await newUseCase();
      const first = workspace('first');
      const gone = join(root, 'gone');
      const third = workspace('third');

      writeSkillDirectory(join(first, 'brainstorm'));
      writeSkillDirectory(join(third, 'brainstorm'));
      handEditState(store, {
        first: { path: first, autoLink: false },
        second: { path: gone, autoLink: false },
        third: { path: third, autoLink: false },
      });
      storeSkill(store, 'brainstorm');

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['first', 'second', 'third'] }),
      );

      expect((error as CloneDeclinedError).refusals.map((refusal) => refusal.kind)).toEqual([
        'occupied',
        'workspace-unreachable',
        'occupied',
      ]);
    });

    it('throws with the "nothing cloned:" block when every workspace was declined', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'brainstorm');
      writeFileSync(join(personal, 'brainstorm'), 'not a skill', 'utf8');
      writeFileSync(join(work, 'brainstorm'), 'not a skill', 'utf8');

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] }),
      );

      expect(error.message.split('\n')).toEqual([
        'nothing cloned:',
        `  could not clone brainstorm → personal: ${join(personal, 'brainstorm')} is not a directory`,
        `  could not clone brainstorm → work: ${join(work, 'brainstorm')} is not a directory`,
      ]);
    });

    it('returns rather than throwing when an alreadyCloned pair sits beside a refusal', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(join(personal, 'brainstorm'));
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
      writeFileSync(join(work, 'brainstorm'), 'not a skill', 'utf8');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.alreadyCloned).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      expect(report.declined).toHaveLength(1);
    });

    it('returns rather than throwing when an adoption sits beside a refusal', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'triage');
      writeSkillDirectory(join(personal, 'triage'));
      writeFileSync(join(work, 'triage'), 'not a skill', 'utf8');

      const report = cloneSkill({ skillName: 'triage', workspaces: ['personal', 'work'], adopt: true });

      expect(report.adopted).toEqual([{ skill: 'triage', workspace: 'personal' }]);
      expect(report.declined).toEqual([
        {
          kind: 'occupied',
          skill: 'triage',
          workspace: 'work',
          path: join(work, 'triage'),
          occupant: { kind: 'not-a-directory' },
        },
      ]);
    });

    it('returns an empty report and writes nothing for an empty workspaces array', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');

      expect(cloneSkill({ skillName: 'brainstorm', workspaces: [] })).toEqual({
        cloned: [],
        adopted: [],
        alreadyCloned: [],
        declined: [],
      });
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
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

  /** A registered workspace, returning the path it was registered at. */
  function workspace(name: string, options: { autoLink?: boolean; path?: string } = {}): string {
    const path = options.path ?? join(root, name);

    if (!options.path) {
      mkdirSync(path, { recursive: true });
    }

    return manager.registerWorkspace({ name, path, autoLink: options.autoLink }).path;
  }

  return {
    cloneSkill: createCloneSkillUseCase({ storeManager: manager }),
    manager,
    store,
    root,
    workspace,
  };
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

function storeSkill(store: GrimoireStore, name: string, files: Record<string, string> = {}): string {
  return writeSkillDirectory(join(store.paths.skills, name), files);
}

/**
 * A `state.json` written past the manager, for the states only a hand-edit can
 * reach — `registerWorkspace` refuses every one of them.
 */
function handEditState(
  store: GrimoireStore,
  workspaces: Record<string, { path: string; autoLink: boolean }>,
): void {
  mkdirSync(dirname(store.paths.state), { recursive: true });
  writeFileSync(store.paths.state, JSON.stringify({ workspaces }, null, 2), 'utf8');
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
