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
import { describe, expect, it } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '#src/domains/skill/index';
import {
  CollidingRegistrationError,
  EntityNotFoundError,
  LinkDeclinedError,
  UnportableSkillError,
} from '#src/lib/errors/index';
import { DS_STORE_NAME, finderDsStoreBytes } from '#test-helpers/ds-store';
import { lockDirectory, runsAsRoot } from '#test-helpers/locked-directory';
import { tempRoot } from '#test-helpers/temp-root';
import { createLinkSkillUseCase } from '../factory.ts';

describe('link-skill-use-case factory', () => {
  describe('the links it writes', () => {
    it('symlinks the skill into a named workspace, targeting the lexical store path', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] });

      expect(report.linked).toEqual([{ skill: 'brainstorm', workspace: 'personal', replaced: false }]);
      expect(readlinkSync(join(personal, 'brainstorm'))).toBe(join(store.paths.skills, 'brainstorm'));
    });

    it('links into every auto-link workspace when none is named, sorted by name', async () => {
      const { linkSkill, store, workspace } = await newUseCase();

      workspace('work', { autoLink: true });
      workspace('personal', { autoLink: true });
      storeSkill(store, 'brainstorm');

      const report = linkSkill({ skillNames: ['brainstorm'] });

      expect(report.linked.map(({ workspace: name }) => name)).toEqual(['personal', 'work']);
    });

    it('leaves a workspace that does not auto-link out of the default set', async () => {
      const { linkSkill, store, workspace } = await newUseCase();

      workspace('personal', { autoLink: true });
      const manual = workspace('work');
      storeSkill(store, 'brainstorm');

      expect(linkSkill({ skillNames: ['brainstorm'] }).linked).toEqual([
        { skill: 'brainstorm', workspace: 'personal', replaced: false },
      ]);
      expect(existsSync(join(manual, 'brainstorm'))).toBe(false);
    });

    // The default set is requested by omitting the list, so an empty one is a
    // filter that matches nothing rather than a second spelling of `undefined`.
    it('links nothing when handed an empty workspace list', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal', { autoLink: true });

      storeSkill(store, 'brainstorm');

      expect(linkSkill({ skillNames: ['brainstorm'], workspaces: [] })).toEqual({
        linked: [],
        alreadyLinked: [],
        declined: [],
      });
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('writes one link for a workspace named twice', async () => {
      const { linkSkill, store, workspace } = await newUseCase();

      workspace('personal');
      storeSkill(store, 'brainstorm');

      expect(
        linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'personal'] }).linked,
      ).toEqual([{ skill: 'brainstorm', workspace: 'personal', replaced: false }]);
    });

    it('reports a correct symlink already in place without rewriting it', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      symlinkSync(storeSkill(store, 'brainstorm'), path);
      const before = lstatSync(path).mtimeMs;

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] });

      expect(report.alreadyLinked).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      expect(report.linked).toEqual([]);
      expect(lstatSync(path).mtimeMs).toBe(before);
    });

    it('replaces a directory holding nothing, marking it replaced', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      mkdirSync(path);

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] });

      expect(report.linked).toEqual([{ skill: 'brainstorm', workspace: 'personal', replaced: true }]);
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    });

    it('replaces a directory that differs from the store copy only by a Finder .DS_Store', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(path, { [DS_STORE_NAME]: finderDsStoreBytes() });

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] });

      expect(report.linked).toEqual([{ skill: 'brainstorm', workspace: 'personal', replaced: true }]);
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    });
  });

  /**
   * A fact about the filesystem rather than a mistake in argv: the destination
   * drops out and whatever else was asked for still happens.
   */
  describe('the destinations it declines', () => {
    it('declines a directory whose content differs, leaving it in place', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(path, { [SKILL_MANIFEST]: 'edited' });

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          occupant: { kind: 'differing-directory', entry: SKILL_MANIFEST },
        },
      ]);
      expect(readFileSync(join(path, SKILL_MANIFEST), 'utf8')).toBe('edited');
      expect(lstatSync(join(work, 'brainstorm')).isSymbolicLink()).toBe(true);
    });

    it('declines a directory holding a hand-made .DS_Store', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      workspace('work');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(path, { [DS_STORE_NAME]: 'my own notes' });

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          occupant: { kind: 'differing-directory', entry: DS_STORE_NAME },
        },
      ]);
      expect(existsSync(join(path, DS_STORE_NAME))).toBe(true);
    });

    it('declines a directory the store records as a clone, even when it matches the store copy', async () => {
      const { linkSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(path);
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          occupant: { kind: 'clone' },
        },
      ]);
      expect(lstatSync(path).isDirectory()).toBe(true);
      expect(lstatSync(join(work, 'brainstorm')).isSymbolicLink()).toBe(true);
    });

    it('declines a clone recorded by path, not only by workspace name', async () => {
      const { linkSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(path);
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
      manager.recordClonesByPath({ workspace: 'personal', path: personal });

      const error = refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] }));

      expect(error).toBeInstanceOf(LinkDeclinedError);
      expect((error as LinkDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          occupant: { kind: 'clone' },
        },
      ]);
      expect(lstatSync(path).isDirectory()).toBe(true);
    });

    it('names the clone rather than the difference when a recorded clone has drifted', async () => {
      const { linkSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(path, { [SKILL_MANIFEST]: 'edited' });
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

      const error = refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] }));

      expect(error.message).toBe(
        `could not link brainstorm → personal: ${path} is a clone — unclone it first with \`grimoire unclone brainstorm personal\``,
      );
    });

    it('declines a plain file at the destination', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeFileSync(path, 'not a skill', 'utf8');

      expect(
        refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] })),
      ).toBeInstanceOf(LinkDeclinedError);
      expect(readFileSync(path, 'utf8')).toBe('not a skill');
    });

    it('declines a symlink pointing at a different store skill', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const path = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      symlinkSync(storeSkill(store, 'triage'), path);

      const error = refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] }));

      expect(error).toBeInstanceOf(LinkDeclinedError);
      expect((error as LinkDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path,
          occupant: { kind: 'foreign-symlink' },
        },
      ]);
      expect(readlinkSync(path)).toBe(join(store.paths.skills, 'triage'));
    });

    // `relate` compares as far as the filesystem can confirm, so a link whose
    // target is gone is answered rather than thrown on.
    it('declines a symlink that resolves to nothing rather than failing on it', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');
      symlinkSync(join(store.paths.skills, 'deleted'), join(personal, 'brainstorm'));

      expect(
        refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] })),
      ).toBeInstanceOf(LinkDeclinedError);
    });

    /**
     * The one unreachable path that does not arrive as an `InvalidPathError`:
     * `stat` follows symlinks, so a cycle raises ELOOP. Uncaught, it would end
     * the run over a single destination.
     */
    it('declines a workspace path that is a symlink cycle, and links the rest', async () => {
      const { linkSkill, store, root } = await newUseCase();
      const work = join(root, 'work');
      const cycle = join(root, 'a');

      mkdirSync(work);
      symlinkSync(join(root, 'b'), cycle);
      symlinkSync(cycle, join(root, 'b'));
      handEditState(store, {
        personal: { path: cycle, autoLink: false },
        work: { path: work, autoLink: false },
      });
      storeSkill(store, 'brainstorm');

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        { kind: 'workspace-unreachable', workspace: 'personal', path: cycle },
      ]);
      expect(report.linked).toEqual([{ skill: 'brainstorm', workspace: 'work', replaced: false }]);
    });

    /**
     * Not a decline: a path inside the store is illegal rather than merely
     * unusable, and the registry refuses to load at all while one is registered.
     * So the healthy workspace beside it is not linked either — the read that
     * would have found it is what throws.
     */
    it('refuses the run when a workspace path sits inside the store', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const work = workspace('work');
      const path = join(store.paths.skills, 'personal');

      mkdirSync(path, { recursive: true });
      handEditState(store, {
        personal: { path, autoLink: false },
        work: { path: work, autoLink: false },
      });
      storeSkill(store, 'brainstorm');

      expect(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] })).toThrow(
        CollidingRegistrationError,
      );
      expect(existsSync(join(path, 'brainstorm'))).toBe(false);
      expect(existsSync(join(work, 'brainstorm'))).toBe(false);
    });

    it('declines a registered directory that is gone rather than creating it', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const work = workspace('work');
      const path = workspace('personal');

      rmSync(path, { recursive: true });
      storeSkill(store, 'brainstorm');

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([{ kind: 'workspace-unreachable', workspace: 'personal', path }]);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(join(work, 'brainstorm'))).toBe(true);
    });

    it('declines a registered path that has become a file', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const path = workspace('personal');

      rmSync(path, { recursive: true });
      writeFileSync(path, '', 'utf8');
      storeSkill(store, 'brainstorm');

      const error = refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] }));

      expect((error as LinkDeclinedError).refusals).toEqual([
        { kind: 'workspace-unreachable', workspace: 'personal', path },
      ]);
    });

    // `statSync` answers `undefined` for a path buried under a file exactly as
    // for a missing one, so this arrives as the same refusal.
    it('declines a registered path whose parent has become a file', async () => {
      const { linkSkill, store, workspace, root } = await newUseCase();
      const parent = join(root, 'project');

      mkdirSync(parent);
      const path = workspace('personal', { path: join(parent, 'skills') });

      rmSync(parent, { recursive: true });
      writeFileSync(parent, '', 'utf8');
      storeSkill(store, 'brainstorm');

      const error = refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] }));

      expect((error as LinkDeclinedError).refusals).toEqual([
        { kind: 'workspace-unreachable', workspace: 'personal', path },
      ]);
    });

    describe.skipIf(runsAsRoot)('a workspace that cannot be read', () => {
      it('declines it rather than throwing, and links the rest', async () => {
        const { linkSkill, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        const work = workspace('work');

        storeSkill(store, 'brainstorm');
        lockDirectory({ path: personal });

        const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] });

        expect(report.declined).toEqual([
          { kind: 'workspace-unreadable', workspace: 'personal', path: personal },
        ]);
        expect(report.linked).toEqual([{ skill: 'brainstorm', workspace: 'work', replaced: false }]);
        expect(existsSync(join(work, 'brainstorm'))).toBe(true);
      });
    });
  });

  /**
   * A run with nothing to show for itself exits like every other refusal. Safe
   * to decide at the end, because a run with no successes performed no writes.
   */
  describe('a run that linked nothing', () => {
    it('throws when every destination was declined', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');
      writeFileSync(join(personal, 'brainstorm'), 'not a skill', 'utf8');

      expect(
        refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] })),
      ).toBeInstanceOf(LinkDeclinedError);
    });

    it('summarizes every refusal that blocked it', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'brainstorm');
      writeFileSync(join(personal, 'brainstorm'), 'not a skill', 'utf8');
      writeFileSync(join(work, 'brainstorm'), 'not a skill', 'utf8');

      const error = refusal(() =>
        linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] }),
      );

      expect(error.message.split('\n')).toEqual([
        'nothing linked:',
        `  could not link brainstorm → personal: ${join(personal, 'brainstorm')} is not a directory`,
        `  could not link brainstorm → work: ${join(work, 'brainstorm')} is not a directory`,
      ]);
    });

    // A link already in place is a success: the destination holds what was
    // asked for, so the run has something to confirm.
    it('returns rather than throwing when a link was already in place', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      symlinkSync(storeSkill(store, 'brainstorm'), join(personal, 'brainstorm'));
      writeFileSync(join(work, 'brainstorm'), 'not a skill', 'utf8');

      const report = linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'work'] });

      expect(report.alreadyLinked).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      expect(report.declined).toHaveLength(1);
    });
  });

  /**
   * Nothing was stepped over and nothing is half-done, so this is an empty
   * report rather than a refusal. Whether the caller *wanted* the default set —
   * and so whether an empty report needs explaining — is the caller's own fact.
   */
  describe('an empty default destination set', () => {
    it('returns an empty report rather than throwing', async () => {
      const { linkSkill, store, workspace } = await newUseCase();

      workspace('personal');
      storeSkill(store, 'brainstorm');

      expect(linkSkill({ skillNames: ['brainstorm'] })).toEqual({
        linked: [],
        alreadyLinked: [],
        declined: [],
      });
    });

    it('writes nothing into the workspaces it skipped', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');
      linkSkill({ skillNames: ['brainstorm'] });

      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('returns an empty report against a store holding no workspaces at all', async () => {
      const { linkSkill, store } = await newUseCase();

      storeSkill(store, 'brainstorm');

      expect(linkSkill({ skillNames: ['brainstorm'] }).linked).toEqual([]);
    });
  });

  /**
   * A name that resolves to nothing is a mistake in argv rather than a fact
   * about the filesystem, so it ends the run before anything is examined.
   */
  describe('names that resolve to nothing', () => {
    it('throws on a workspace name that is not registered, linking nothing', async () => {
      const { linkSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');

      expect(
        refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal', 'ghost'] })),
      ).toBeInstanceOf(EntityNotFoundError);
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('throws on a skill the store does not hold', async () => {
      const { linkSkill, workspace } = await newUseCase();

      workspace('personal');

      expect(
        refusal(() => linkSkill({ skillNames: ['ghost'], workspaces: ['personal'] })),
      ).toBeInstanceOf(EntityNotFoundError);
    });

    it('throws on a store directory holding no SKILL.md', async () => {
      const { linkSkill, store, workspace } = await newUseCase();

      workspace('personal');
      mkdirSync(join(store.paths.skills, 'brainstorm'), { recursive: true });

      expect(
        refusal(() => linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] })),
      ).toBeInstanceOf(UnportableSkillError);
    });
  });

  // A store manager captured at call time rather than at construction would let
  // two use cases built from different stores write to whichever ran last.
  it('links against the store manager it was built with', async () => {
    const first = await newUseCase();
    const second = await newUseCase();

    first.workspace('personal');
    storeSkill(first.store, 'brainstorm');
    storeSkill(second.store, 'brainstorm');

    expect(
      refusal(() => second.linkSkill({ skillNames: ['brainstorm'], workspaces: ['personal'] })),
    ).toBeInstanceOf(EntityNotFoundError);
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
    linkSkill: createLinkSkillUseCase({ storeManager: manager }),
    manager,
    store,
    root,
    workspace,
  };
}

/** A skill directory, whose manifest any entry in `files` may override. */
function writeSkillDirectory(path: string, files: Record<string, string | Buffer> = {}): string {
  mkdirSync(path, { recursive: true });

  for (const [name, content] of Object.entries({ [SKILL_MANIFEST]: '# skill\n', ...files })) {
    writeFileSync(join(path, name), content, 'utf8');
  }

  return path;
}

function storeSkill(store: GrimoireStore, name: string): string {
  return writeSkillDirectory(join(store.paths.skills, name));
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
