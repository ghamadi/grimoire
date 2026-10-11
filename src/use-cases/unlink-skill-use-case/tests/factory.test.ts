import {
  chmodSync,
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
import { describe, expect, it } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '@/domains/skill/index';
import { EntityNotFoundError, UnlinkDeclinedError } from '@/lib/errors/index';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';
import { createUnlinkSkillUseCase } from '@/use-cases/unlink-skill-use-case/factory';

describe('unlink-skill-use-case factory', () => {
  describe('the links it removes', () => {
    it('removes a symlink and reports it as unlinked', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const path = linkInto(workspace('personal'), storeSkill(store, 'brainstorm'));

      const report = unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.unlinked).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      expect(existsSync(path)).toBe(false);
    });

    it("leaves the store's copy of the skill in place", async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const skillPath = storeSkill(store, 'brainstorm');

      linkInto(workspace('personal'), skillPath);
      unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(existsSync(join(skillPath, SKILL_MANIFEST))).toBe(true);
    });

    it('removes a chained link through an intermediate symlink', async () => {
      const { unlinkSkill, store, workspace, root } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');
      const intermediate = join(root, 'alias');

      symlinkSync(storeSkill(store, 'brainstorm'), intermediate);
      symlinkSync(intermediate, path);

      const report = unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.unlinked).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(intermediate)).toBe(true);
    });

    it('reports one pair for a workspace named twice', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();

      linkInto(workspace('personal'), storeSkill(store, 'brainstorm'));

      expect(
        unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'personal'] }).unlinked,
      ).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
    });

    it('reports several workspaces in argument order', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const skillPath = storeSkill(store, 'brainstorm');

      linkInto(workspace('work'), skillPath);
      linkInto(workspace('personal'), skillPath);

      expect(
        unlinkSkill({ skillName: 'brainstorm', workspaces: ['work', 'personal'] }).unlinked,
      ).toEqual([
        { skill: 'brainstorm', workspace: 'work' },
        { skill: 'brainstorm', workspace: 'personal' },
      ]);
    });

    it("leaves an auto-link workspace's registry entry unchanged", async () => {
      const { unlinkSkill, store, manager, workspace } = await newUseCase();
      const personal = workspace('personal', { autoLink: true });

      linkInto(personal, storeSkill(store, 'brainstorm'));
      unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(manager.getRegistry().workspaces).toEqual({
        personal: { path: personal, autoLink: true },
      });
    });
  });

  describe('destinations holding no link', () => {
    it('treats nothing at the destination as holding no link', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();

      workspace('personal');
      storeSkill(store, 'brainstorm');

      expect(unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] })).toEqual({
        unlinked: [],
        notLinked: [{ skill: 'brainstorm', workspace: 'personal' }],
        declined: [],
      });
    });
  });

  describe('workspaces whose registered path no longer resolves', () => {
    it('declines a registered directory that is gone', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const path = workspace('personal');

      workspace('work');
      rmSync(path, { recursive: true });
      storeSkill(store, 'brainstorm');

      expect(unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] })).toEqual({
        unlinked: [],
        notLinked: [{ skill: 'brainstorm', workspace: 'work' }],
        declined: [
          {
            skill: 'brainstorm',
            workspace: 'personal',
            path: join(path, 'brainstorm'),
            reason: 'workspace-unreachable',
          },
        ],
      });
    });

    it('declines a registered path that has become a file', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const path = workspace('personal');

      workspace('work');
      rmSync(path, { recursive: true });
      writeFileSync(path, '', 'utf8');
      storeSkill(store, 'brainstorm');

      expect(
        unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] }).declined,
      ).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path: join(path, 'brainstorm'),
          reason: 'workspace-unreachable',
        },
      ]);
    });

    it('declines a registered path whose parent has become a file', async () => {
      const { unlinkSkill, store, workspace, root } = await newUseCase();
      const parent = join(root, 'project');

      mkdirSync(parent);
      const path = workspace('personal', { path: join(parent, 'skills') });

      workspace('work');
      rmSync(parent, { recursive: true });
      writeFileSync(parent, '', 'utf8');
      storeSkill(store, 'brainstorm');

      expect(
        unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] }).declined,
      ).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path: join(path, 'brainstorm'),
          reason: 'workspace-unreachable',
        },
      ]);
    });

    it('declines a registered path that is a symlink cycle', async () => {
      const { unlinkSkill, store, workspace, root } = await newUseCase();
      const cycle = join(root, 'a');

      symlinkSync(join(root, 'b'), cycle);
      symlinkSync(cycle, join(root, 'b'));
      const work = workspace('work');

      handEditState(store, {
        personal: { path: cycle, autoLink: false },
        work: { path: work, autoLink: false },
      });
      storeSkill(store, 'brainstorm');

      expect(
        unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] }).declined,
      ).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path: join(cycle, 'brainstorm'),
          reason: 'workspace-unreachable',
        },
      ]);
    });

    it('leaves the unreachable workspace registered', async () => {
      const { unlinkSkill, store, manager, workspace } = await newUseCase();
      const path = workspace('personal', { autoLink: true });
      const work = workspace('work');

      rmSync(path, { recursive: true });
      storeSkill(store, 'brainstorm');
      unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(manager.getRegistry().workspaces).toEqual({
        personal: { path, autoLink: true },
        work: { path: work, autoLink: false },
      });
    });

    it('unlinks from the workspaces that do resolve', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const gone = workspace('personal');
      const work = workspace('work');

      rmSync(gone, { recursive: true });
      linkInto(work, storeSkill(store, 'brainstorm'));

      const report = unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.unlinked).toEqual([{ skill: 'brainstorm', workspace: 'work' }]);
      expect(report.declined).toHaveLength(1);
    });
  });

  describe.skipIf(runsAsRoot)('workspaces that cannot be read', () => {
    it('declines a workspace with no permissions and leaves the link inside untouched', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const skillPath = storeSkill(store, 'brainstorm');
      const link = linkInto(personal, skillPath);

      workspace('work');
      lockDirectory({ path: personal });

      expect(unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] })).toEqual({
        unlinked: [],
        notLinked: [{ skill: 'brainstorm', workspace: 'work' }],
        declined: [
          {
            skill: 'brainstorm',
            workspace: 'personal',
            path: link,
            reason: 'workspace-unreadable',
          },
        ],
      });

      chmodSync(personal, 0o755);

      expect(readlinkSync(link)).toBe(skillPath);
    });

    // `stat` of the workspace itself is what fails here, before any `lstat`.
    it('declines a workspace under a directory that cannot be entered', async () => {
      const { unlinkSkill, store, workspace, root } = await newUseCase();
      const parent = join(root, 'project');

      mkdirSync(parent);
      const personal = workspace('personal', { path: join(parent, 'skills') });
      const skillPath = storeSkill(store, 'brainstorm');
      const link = linkInto(personal, skillPath);

      workspace('work');
      lockDirectory({ path: parent });

      expect(
        unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] }).declined,
      ).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path: link,
          reason: 'workspace-unreadable',
        },
      ]);

      chmodSync(parent, 0o755);

      expect(readlinkSync(link)).toBe(skillPath);
    });
  });

  describe('the destinations it declines', () => {
    it('declines a directory at the path, leaving it in place', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      mkdirSync(path);
      linkInto(work, join(store.paths.skills, 'brainstorm'));

      const report = unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          reason: 'directory',
        },
      ]);
      expect(report.unlinked).toEqual([{ skill: 'brainstorm', workspace: 'work' }]);
      expect(lstatSync(path).isDirectory()).toBe(true);
    });

    it('declines a plain file at the destination, leaving it in place', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeFileSync(path, 'not a skill', 'utf8');

      const error = refusal(() => unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect(error).toBeInstanceOf(UnlinkDeclinedError);
      expect(readFileSync(path, 'utf8')).toBe('not a skill');
    });

    it('declines a symlink pointing at a different store skill, leaving it in place', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      symlinkSync(storeSkill(store, 'triage'), path);

      const error = refusal(() => unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect((error as UnlinkDeclinedError).refusals).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          reason: 'foreign-symlink',
        },
      ]);
      expect(readlinkSync(path)).toBe(join(store.paths.skills, 'triage'));
    });

    it('declines a symlink pointing inside the store skill, leaving it in place', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');
      const inside = join(storeSkill(store, 'brainstorm'), 'references');

      mkdirSync(inside);
      symlinkSync(inside, path);

      const error = refusal(() => unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect((error as UnlinkDeclinedError).refusals).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          reason: 'foreign-symlink',
        },
      ]);
      expect(readlinkSync(path)).toBe(inside);
    });

    it('declines a symlink whose target no longer exists', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      symlinkSync(join(store.paths.skills, 'deleted'), path);

      const error = refusal(() => unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect((error as UnlinkDeclinedError).refusals).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          reason: 'foreign-symlink',
        },
      ]);
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    });
  });

  describe('a run that unlinked nothing', () => {
    it('throws when every pair was declined, leaving the destinations in place', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');
      const personalPath = join(personal, 'brainstorm');
      const workPath = join(work, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeFileSync(personalPath, 'not a skill', 'utf8');
      writeFileSync(workPath, 'not a skill', 'utf8');

      const error = refusal(() =>
        unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] }),
      );

      expect(error).toBeInstanceOf(UnlinkDeclinedError);
      expect((error as UnlinkDeclinedError).refusals).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path: personalPath,
          reason: 'not-a-link',
        },
        {
          skill: 'brainstorm',
          workspace: 'work',
          path: workPath,
          reason: 'not-a-link',
        },
      ]);
      expect(readFileSync(personalPath, 'utf8')).toBe('not a skill');
      expect(readFileSync(workPath, 'utf8')).toBe('not a skill');
    });

    it('returns rather than throwing when a declined pair sits beside a notLinked pair', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      workspace('work');
      const personalPath = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeFileSync(personalPath, 'not a skill', 'utf8');

      const report = unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report).toEqual({
        unlinked: [],
        notLinked: [{ skill: 'brainstorm', workspace: 'work' }],
        declined: [
          {
            skill: 'brainstorm',
            workspace: 'personal',
            path: personalPath,
            reason: 'not-a-link',
          },
        ],
      });
    });

    it('throws when the only workspace is unreachable', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const path = workspace('personal');

      rmSync(path, { recursive: true });
      storeSkill(store, 'brainstorm');

      const error = refusal(() => unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect(error).toBeInstanceOf(UnlinkDeclinedError);
      expect((error as UnlinkDeclinedError).refusals).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path: join(path, 'brainstorm'),
          reason: 'workspace-unreachable',
        },
      ]);
    });

    it('returns when an unreachable workspace sits beside a notLinked pair', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const gone = workspace('personal');

      workspace('work');
      rmSync(gone, { recursive: true });
      storeSkill(store, 'brainstorm');

      expect(
        unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] }).notLinked,
      ).toEqual([{ skill: 'brainstorm', workspace: 'work' }]);
    });
  });

  describe('names that resolve to nothing', () => {
    it('throws on an unknown skill, leaving an existing link in place', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const path = linkInto(workspace('personal'), storeSkill(store, 'brainstorm'));

      expect(
        refusal(() => unlinkSkill({ skillName: 'ghost', workspaces: ['personal'] })),
      ).toBeInstanceOf(EntityNotFoundError);
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    });

    it('throws on an unregistered workspace before the one named ahead of it is touched', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const path = linkInto(workspace('personal'), storeSkill(store, 'brainstorm'));

      expect(
        refusal(() => unlinkSkill({ skillName: 'brainstorm', workspaces: ['personal', 'ghost'] })),
      ).toBeInstanceOf(EntityNotFoundError);
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    });

    it('throws for the skill when both the skill and a workspace are unknown', async () => {
      const { unlinkSkill } = await newUseCase();

      const error = refusal(() => unlinkSkill({ skillName: 'ghost', workspaces: ['missing'] }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entity).toBe('skill');
    });
  });

  describe('every registered workspace', () => {
    it('removes the link from each workspace holding it, reported sorted by name', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const skillPath = storeSkill(store, 'brainstorm');
      const work = workspace('work');
      const personal = workspace('personal');

      linkInto(work, skillPath);
      linkInto(personal, skillPath);

      const report = unlinkSkill({ skillName: 'brainstorm', workspaces: 'all' });

      expect(report.unlinked).toEqual([
        { skill: 'brainstorm', workspace: 'personal' },
        { skill: 'brainstorm', workspace: 'work' },
      ]);
      expect(existsSync(join(work, 'brainstorm'))).toBe(false);
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('includes both auto-link and manual workspaces', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const skillPath = storeSkill(store, 'brainstorm');
      const auto = workspace('auto', { autoLink: true });
      const manual = workspace('manual');

      linkInto(auto, skillPath);
      linkInto(manual, skillPath);

      expect(unlinkSkill({ skillName: 'brainstorm', workspaces: 'all' }).unlinked).toEqual([
        { skill: 'brainstorm', workspace: 'auto' },
        { skill: 'brainstorm', workspace: 'manual' },
      ]);
    });

    it('reports every other destination as if it were named, leaving each in place', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const skillPath = storeSkill(store, 'brainstorm');
      const triagePath = storeSkill(store, 'triage');

      const linked = workspace('linked');
      const empty = workspace('empty');
      const dir = workspace('dir');
      const file = workspace('file');
      const foreign = workspace('foreign');
      const gone = workspace('gone');

      const linkPath = linkInto(linked, skillPath);
      const dirPath = join(dir, 'brainstorm');
      mkdirSync(dirPath);
      const filePath = join(file, 'brainstorm');
      writeFileSync(filePath, 'not a skill', 'utf8');
      const foreignPath = join(foreign, 'brainstorm');
      symlinkSync(triagePath, foreignPath);
      rmSync(gone, { recursive: true });

      const report = unlinkSkill({ skillName: 'brainstorm', workspaces: 'all' });

      expect(report).toEqual({
        unlinked: [{ skill: 'brainstorm', workspace: 'linked' }],
        notLinked: [{ skill: 'brainstorm', workspace: 'empty' }],
        declined: [
          { skill: 'brainstorm', workspace: 'dir', path: dirPath, reason: 'directory' },
          { skill: 'brainstorm', workspace: 'file', path: filePath, reason: 'not-a-link' },
          { skill: 'brainstorm', workspace: 'foreign', path: foreignPath, reason: 'foreign-symlink' },
          {
            skill: 'brainstorm',
            workspace: 'gone',
            path: join(gone, 'brainstorm'),
            reason: 'workspace-unreachable',
          },
        ],
      });
      expect(existsSync(linkPath)).toBe(false);
      expect(existsSync(empty)).toBe(true);
      expect(lstatSync(dirPath).isDirectory()).toBe(true);
      expect(readFileSync(filePath, 'utf8')).toBe('not a skill');
      expect(readlinkSync(foreignPath)).toBe(triagePath);
    });

    it('throws when every workspace was declined', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const path = join(workspace('personal'), 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeFileSync(path, 'not a skill', 'utf8');

      const error = refusal(() => unlinkSkill({ skillName: 'brainstorm', workspaces: 'all' }));

      expect((error as UnlinkDeclinedError).refusals).toEqual([
        { skill: 'brainstorm', workspace: 'personal', path, reason: 'not-a-link' },
      ]);
      expect(readFileSync(path, 'utf8')).toBe('not a skill');
    });

    it('throws rather than reporting nothing when every registered workspace is unreachable', async () => {
      const { unlinkSkill, store, manager, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      rmSync(personal, { recursive: true });
      rmSync(work, { recursive: true });
      storeSkill(store, 'brainstorm');

      const error = refusal(() => unlinkSkill({ skillName: 'brainstorm', workspaces: 'all' }));

      expect((error as UnlinkDeclinedError).refusals).toEqual([
        {
          skill: 'brainstorm',
          workspace: 'personal',
          path: join(personal, 'brainstorm'),
          reason: 'workspace-unreachable',
        },
        {
          skill: 'brainstorm',
          workspace: 'work',
          path: join(work, 'brainstorm'),
          reason: 'workspace-unreachable',
        },
      ]);
      expect(Object.keys(manager.getRegistry().workspaces)).toEqual(['personal', 'work']);
    });

    it('returns an all-empty report when no workspace is registered', async () => {
      const { unlinkSkill, store } = await newUseCase();
      storeSkill(store, 'brainstorm');

      expect(unlinkSkill({ skillName: 'brainstorm', workspaces: 'all' })).toEqual({
        unlinked: [],
        notLinked: [],
        declined: [],
      });
    });

    it('throws EntityNotFoundError for an unknown skill, leaving an existing link in place', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();
      const path = linkInto(workspace('personal'), storeSkill(store, 'brainstorm'));

      expect(refusal(() => unlinkSkill({ skillName: 'ghost', workspaces: 'all' }))).toBeInstanceOf(
        EntityNotFoundError,
      );
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    });
  });

  describe('an empty workspace list', () => {
    it('returns an empty report rather than throwing', async () => {
      const { unlinkSkill, store, workspace } = await newUseCase();

      workspace('personal');
      storeSkill(store, 'brainstorm');

      expect(unlinkSkill({ skillName: 'brainstorm', workspaces: [] })).toEqual({
        unlinked: [],
        notLinked: [],
        declined: [],
      });
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

  function workspace(name: string, options: { autoLink?: boolean; path?: string } = {}): string {
    return manager.registerWorkspace({
      name,
      path: options.path ?? join(root, name),
      autoLink: options.autoLink,
    }).path;
  }

  return {
    unlinkSkill: createUnlinkSkillUseCase({ storeManager: manager }),
    manager,
    store,
    root,
    workspace,
  };
}

function linkInto(workspacePath: string, skillPath: string, skillName = 'brainstorm'): string {
  const path = join(workspacePath, skillName);
  symlinkSync(skillPath, path);
  return path;
}

function storeSkill(store: GrimoireStore, name: string): string {
  const path = join(store.paths.skills, name);

  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, SKILL_MANIFEST), '# skill\n', 'utf8');

  return path;
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
