import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store';
import { SKILL_MANIFEST } from '@/domains/skill';
import { CollidingRegistrationError, InvalidShapeError } from '@/lib/errors';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';
import { createReportStatusUseCase } from '@/use-cases/report-status-use-case/factory';

describe('report-status-use-case factory', () => {
  it('reports an empty store with nothing in it', async () => {
    const { reportStatus, store } = await newUseCase();

    expect(reportStatus()).toEqual({
      workspaceStatuses: [],
      recordedPathStatuses: [],
      storeStatus: {
        path: store.paths.skills,
        statePath: store.paths.state,
        skills: [],
        notDeployed: [],
        problems: [],
      },
    });
  });

  describe('linked', () => {
    it('comes back sorted by skill', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      handEditState(store, { workspaces: { personal: registration(personal) } });
      linkSkill({ store, workspace: personal, skill: 'triage' });
      linkSkill({ store, workspace: personal, skill: 'brainstorm' });

      expect(reportStatus().workspaceStatuses[0]?.linked).toEqual([
        { skill: 'brainstorm', entry: 'brainstorm' },
        { skill: 'triage', entry: 'triage' },
      ]);
    });

    it('carries the entry name of a renamed link', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      handEditState(store, { workspaces: { personal: registration(personal) } });
      linkSkill({ store, workspace: personal, skill: 'triage', entry: 'tri' });

      expect(reportStatus().workspaceStatuses[0]?.linked).toEqual([{ skill: 'triage', entry: 'tri' }]);
    });
  });

  describe('cloned', () => {
    it('lists a clone whose directory exists', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'triage');
      newDirectory(personal, 'triage');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.cloned).toEqual(['triage']);
    });

    it('omits a clone whose directory is gone', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'triage');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.cloned).toEqual([]);
    });

    it('still lists a clone whose skill is gone from the store', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      newDirectory(personal, 'old');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { old: { clones: [{ workspace: 'personal' }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.cloned).toEqual(['old']);
    });

    it('does not count a symlink at <dir>/<skill> as a clone', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      symlinkSync(newDirectory(root, 'elsewhere'), join(personal, 'triage'));
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.cloned).toEqual([]);
    });
  });

  describe('a staging directory a clone left behind', () => {
    it('changes nothing in the report', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'triage');
      newDirectory(personal, 'triage');
      linkSkill({ store, workspace: personal, skill: 'brainstorm' });
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }] } },
      });

      const before = reportStatus();

      const leftover = newDirectory(personal, '.grimoire-staging', 'triage.abc.incoming');
      writeFileSync(join(leftover, SKILL_MANIFEST), '# skill\n', 'utf8');

      expect(reportStatus()).toEqual(before);
    });
  });

  describe('attribution', () => {
    it('files a path record for a workspace under that workspace, with no recorded-path block', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      newDirectory(personal, 'triage');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ path: personal }] } },
      });

      const report = reportStatus();

      expect(report.workspaceStatuses[0]?.cloned).toEqual(['triage']);
      expect(report.recordedPathStatuses).toEqual([]);
    });

    it('does the same when the record is spelled through a symlinked ancestor', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'real', 'personal');

      symlinkSync(join(root, 'real'), join(root, 'alias'));
      newDirectory(personal, 'triage');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ path: join(root, 'alias', 'personal') }] } },
      });

      const report = reportStatus();

      expect(report.workspaceStatuses[0]?.cloned).toEqual(['triage']);
      expect(report.recordedPathStatuses).toEqual([]);
    });

    it('shows the clone in both of two workspaces registered at one path', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const shared = newDirectory(root, 'shared');

      newDirectory(shared, 'triage');
      handEditState(store, {
        workspaces: { first: registration(shared), second: registration(shared) },
        skills: { triage: { clones: [{ workspace: 'first' }] } },
      });

      expect(reportStatus().workspaceStatuses.map(({ name, cloned }) => [name, cloned])).toEqual([
        ['first', ['triage']],
        ['second', ['triage']],
      ]);
    });

    it('lists a skill once when a workspace record and a path record name one directory', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      newDirectory(personal, 'triage');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }, { path: personal }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.cloned).toEqual(['triage']);
    });
  });

  describe('an unreachable workspace', () => {
    it('carries the problem, no links, and its records unverified', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const scratch = join(root, 'gone');

      handEditState(store, {
        workspaces: { scratch: registration(scratch) },
        skills: { deploy: { clones: [{ workspace: 'scratch' }] } },
      });

      expect(reportStatus().workspaceStatuses).toEqual([
        {
          name: 'scratch',
          path: scratch,
          autoLink: false,
          linked: [],
          cloned: ['deploy'],
          problems: [{ kind: 'workspace-unreachable' }],
        },
      ]);
    });

    it('leaves a skill linked only into it not deployed', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const scratch = newDirectory(root, 'scratch');

      handEditState(store, { workspaces: { scratch: registration(scratch) } });
      linkSkill({ store, workspace: scratch, skill: 'triage' });
      rmSync(scratch, { recursive: true });

      expect(reportStatus().storeStatus.notDeployed).toEqual(['triage']);
    });

    it('counts a skill cloned only into it as deployed', async () => {
      const { reportStatus, store, root } = await newUseCase();

      storeSkill(store, 'deploy');
      handEditState(store, {
        workspaces: { scratch: registration(join(root, 'gone')) },
        skills: { deploy: { clones: [{ workspace: 'scratch' }] } },
      });

      expect(reportStatus().storeStatus.notDeployed).toEqual([]);
    });
  });

  describe.skipIf(runsAsRoot)('an unreadable workspace', () => {
    // 0o444 is the case an access check without the search bit would miss: the
    // directory lists, and every read of an entry inside it fails.
    const scenarios = [
      {
        name: 'has no permissions',
        locate: (root: string) => {
          const path = newDirectory(root, 'scratch');

          lockDirectory({ path });

          return path;
        },
      },
      {
        name: 'can be listed but not entered',
        locate: (root: string) => {
          const path = newDirectory(root, 'scratch');

          lockDirectory({ path, mode: 0o444 });

          return path;
        },
      },
      {
        name: 'sits under a directory that cannot be entered',
        locate: (root: string) => {
          const parent = newDirectory(root, 'project');
          const path = newDirectory(parent, 'skills');

          lockDirectory({ path: parent });

          return path;
        },
      },
    ];

    it.each(scenarios)(
      'carries the problem, no links, and its records unverified when it $name',
      async ({ locate }) => {
        const { reportStatus, store, root } = await newUseCase();
        const scratch = locate(root);

        handEditState(store, {
          workspaces: { scratch: registration(scratch) },
          skills: { deploy: { clones: [{ workspace: 'scratch' }] } },
        });

        expect(reportStatus().workspaceStatuses).toEqual([
          {
            name: 'scratch',
            path: scratch,
            autoLink: false,
            linked: [],
            cloned: ['deploy'],
            problems: [{ kind: 'workspace-unreadable' }],
          },
        ]);
      },
    );

    it('leaves a skill linked only into it not deployed', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const scratch = newDirectory(root, 'scratch');

      handEditState(store, { workspaces: { scratch: registration(scratch) } });
      linkSkill({ store, workspace: scratch, skill: 'triage' });
      lockDirectory({ path: scratch });

      expect(reportStatus().storeStatus.notDeployed).toEqual(['triage']);
    });

    it('counts a skill cloned only into it as deployed', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const scratch = newDirectory(root, 'scratch');

      storeSkill(store, 'deploy');
      handEditState(store, {
        workspaces: { scratch: registration(scratch) },
        skills: { deploy: { clones: [{ workspace: 'scratch' }] } },
      });
      lockDirectory({ path: scratch });

      expect(reportStatus().storeStatus.notDeployed).toEqual([]);
    });
  });

  describe('recorded-path blocks', () => {
    it('come back sorted by path', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const later = newDirectory(root, 'b');
      const earlier = newDirectory(root, 'a');

      newDirectory(later, 'triage');
      newDirectory(earlier, 'triage');
      handEditState(store, { skills: { triage: { clones: [{ path: later }, { path: earlier }] } } });

      expect(reportStatus().recordedPathStatuses.map(({ path }) => path)).toEqual([earlier, later]);
    });

    it('make one block for two spellings of a directory', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const directory = newDirectory(root, 'x');

      storeSkill(store, 'deploy');
      storeSkill(store, 'triage');
      newDirectory(directory, 'deploy');
      newDirectory(directory, 'triage');
      handEditState(store, {
        skills: {
          deploy: { clones: [{ path: directory }] },
          triage: { clones: [{ path: `${directory}/` }] },
        },
      });

      expect(reportStatus().recordedPathStatuses).toEqual([
        { path: directory, cloned: ['deploy', 'triage'], problems: [] },
      ]);
    });

    it('make one block for a directory reached through a symlink, printing the smaller spelling', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const real = newDirectory(root, 'real', 'x');
      const alias = join(root, 'alias');

      symlinkSync(join(root, 'real'), alias);
      storeSkill(store, 'deploy');
      storeSkill(store, 'triage');
      newDirectory(real, 'deploy');
      newDirectory(real, 'triage');
      handEditState(store, {
        skills: {
          deploy: { clones: [{ path: real }] },
          triage: { clones: [{ path: join(alias, 'x') }] },
        },
      });

      expect(reportStatus().recordedPathStatuses).toEqual([
        { path: join(alias, 'x'), cloned: ['deploy', 'triage'], problems: [] },
      ]);
    });
  });

  describe('the store block', () => {
    it('lists only the skills deployed nowhere as not deployed', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');
      const old = newDirectory(root, 'old');

      storeSkill(store, 'brainstorm');
      storeSkill(store, 'deploy');
      storeSkill(store, 'review');
      storeSkill(store, 'triage');
      newDirectory(old, 'deploy');
      newDirectory(personal, 'triage');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: {
          deploy: { clones: [{ path: old }] },
          triage: { clones: [{ workspace: 'personal' }] },
        },
      });
      linkSkill({ store, workspace: personal, skill: 'brainstorm' });

      expect(reportStatus().storeStatus.notDeployed).toEqual(['review']);
    });
  });

  describe('clone record problems', () => {
    it('flags a missing clone of a store skill in a workspace as recloneable, and leaves it out of cloned', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'triage');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }] } },
      });

      const [block] = reportStatus().workspaceStatuses;

      expect(block?.cloned).toEqual([]);
      expect(block?.problems).toEqual([{ kind: 'clone-missing', skill: 'triage', recloneable: true }]);
    });

    it('reports one non-recloneable clone-missing when the directory and the skill are both gone', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { old: { clones: [{ workspace: 'personal' }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([
        { kind: 'clone-missing', skill: 'old', recloneable: false },
      ]);
    });

    it('never calls a missing clone in a recorded-path block recloneable, even for a store skill', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const elsewhere = newDirectory(root, 'elsewhere');

      storeSkill(store, 'triage');
      handEditState(store, { skills: { triage: { clones: [{ path: elsewhere }] } } });

      expect(reportStatus().recordedPathStatuses).toEqual([
        {
          path: elsewhere,
          cloned: [],
          problems: [{ kind: 'clone-missing', skill: 'triage', recloneable: false }],
        },
      ]);
    });

    it('reports only clone-missing for every clone of a recorded path that has vanished', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const gone = join(root, 'gone');

      storeSkill(store, 'deploy');
      storeSkill(store, 'triage');
      handEditState(store, {
        skills: { deploy: { clones: [{ path: gone }] }, triage: { clones: [{ path: gone }] } },
      });

      expect(reportStatus().recordedPathStatuses).toEqual([
        {
          path: gone,
          cloned: [],
          problems: [
            { kind: 'clone-missing', skill: 'deploy', recloneable: false },
            { kind: 'clone-missing', skill: 'triage', recloneable: false },
          ],
        },
      ]);
    });

    it('reports a recorded path under a regular file as clone-missing without throwing', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const file = join(root, 'file');
      const path = join(file, 'skills');

      writeFileSync(file, 'not a directory', 'utf8');
      storeSkill(store, 'triage');
      handEditState(store, { skills: { triage: { clones: [{ path }] } } });

      expect(reportStatus().recordedPathStatuses).toEqual([
        {
          path,
          cloned: [],
          problems: [{ kind: 'clone-missing', skill: 'triage', recloneable: false }],
        },
      ]);
    });

    describe.skipIf(runsAsRoot)('a recorded path that cannot be read', () => {
      it('reports every clone under it as clone-missing', async () => {
        const { reportStatus, store, root } = await newUseCase();
        const locked = newDirectory(root, 'locked');

        newDirectory(locked, 'deploy');
        newDirectory(locked, 'triage');
        handEditState(store, {
          skills: { deploy: { clones: [{ path: locked }] }, triage: { clones: [{ path: locked }] } },
        });
        lockDirectory({ path: locked });

        expect(reportStatus().recordedPathStatuses).toEqual([
          {
            path: locked,
            cloned: [],
            problems: [
              { kind: 'clone-missing', skill: 'deploy', recloneable: false },
              { kind: 'clone-missing', skill: 'triage', recloneable: false },
            ],
          },
        ]);
      });
    });

    it('reads a symlink to a directory at <ws>/<skill> as clone-missing', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'triage');
      symlinkSync(newDirectory(root, 'elsewhere'), join(personal, 'triage'));
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([
        { kind: 'clone-missing', skill: 'triage', recloneable: true },
      ]);
    });

    it('reads a regular file at <ws>/<skill> as clone-missing', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'triage');
      writeFileSync(join(personal, 'triage'), 'not a directory', 'utf8');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([
        { kind: 'clone-missing', skill: 'triage', recloneable: true },
      ]);
    });

    it('flags a present clone of a skill gone from the store, and still lists it as cloned', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      newDirectory(personal, 'old');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { old: { clones: [{ workspace: 'personal' }] } },
      });

      const [block] = reportStatus().workspaceStatuses;

      expect(block?.cloned).toEqual(['old']);
      expect(block?.problems).toEqual([{ kind: 'clone-not-in-store', skill: 'old' }]);
    });

    it('runs no clone check against an unreachable workspace', async () => {
      const { reportStatus, store, root } = await newUseCase();

      handEditState(store, {
        workspaces: { scratch: registration(join(root, 'gone')) },
        skills: { old: { clones: [{ workspace: 'scratch' }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([{ kind: 'workspace-unreachable' }]);
    });

    it('reports one problem when a workspace record and an equal path record name one clone', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'triage');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }, { path: personal }] } },
      });

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([
        { kind: 'clone-missing', skill: 'triage', recloneable: true },
      ]);
    });

    it('reports the problem in both of two workspaces registered at one path', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const shared = newDirectory(root, 'shared');

      newDirectory(shared, 'old');
      handEditState(store, {
        workspaces: { first: registration(shared), second: registration(shared) },
        skills: { old: { clones: [{ workspace: 'first' }] } },
      });

      expect(reportStatus().workspaceStatuses.map(({ name, problems }) => [name, problems])).toEqual([
        ['first', [{ kind: 'clone-not-in-store', skill: 'old' }]],
        ['second', [{ kind: 'clone-not-in-store', skill: 'old' }]],
      ]);
    });

    it('orders clone-not-in-store before clone-missing, each sorted by skill', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'alpha');
      storeSkill(store, 'gamma');
      newDirectory(personal, 'beta');
      newDirectory(personal, 'delta');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: {
          alpha: { clones: [{ workspace: 'personal' }] },
          beta: { clones: [{ workspace: 'personal' }] },
          delta: { clones: [{ workspace: 'personal' }] },
          gamma: { clones: [{ workspace: 'personal' }] },
        },
      });

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([
        { kind: 'clone-not-in-store', skill: 'beta' },
        { kind: 'clone-not-in-store', skill: 'delta' },
        { kind: 'clone-missing', skill: 'alpha', recloneable: true },
        { kind: 'clone-missing', skill: 'gamma', recloneable: true },
      ]);
    });
  });

  describe('dangling links', () => {
    it('reports a link whose skill is gone from the store, and leaves it out of linked', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      handEditState(store, { workspaces: { personal: registration(personal) } });
      linkSkill({ store, workspace: personal, skill: 'brainstorm' });
      linkSkill({ store, workspace: personal, skill: 'triage' });
      rmSync(join(store.paths.skills, 'triage'), { recursive: true });

      const [block] = reportStatus().workspaceStatuses;

      expect(block?.linked).toEqual([{ skill: 'brainstorm', entry: 'brainstorm' }]);
      expect(block?.problems).toEqual([
        { kind: 'dangling-link', entry: 'triage', target: join(store.paths.skills, 'triage') },
      ]);
    });

    it('reports a renamed entry under the entry name', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      handEditState(store, { workspaces: { personal: registration(personal) } });
      linkSkill({ store, workspace: personal, skill: 'triage', entry: 'tri' });
      rmSync(join(store.paths.skills, 'triage'), { recursive: true });

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([
        { kind: 'dangling-link', entry: 'tri', target: join(store.paths.skills, 'triage') },
      ]);
    });

    it('lists dangling-link before clone problems', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      storeSkill(store, 'alpha');
      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { alpha: { clones: [{ workspace: 'personal' }] } },
      });
      symlinkSync(join(store.paths.skills, 'gone'), join(personal, 'gone'));

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([
        { kind: 'dangling-link', entry: 'gone', target: join(store.paths.skills, 'gone') },
        { kind: 'clone-missing', skill: 'alpha', recloneable: true },
      ]);
    });

    it('is not looked for in an unreachable workspace', async () => {
      const { reportStatus, store, root } = await newUseCase();

      handEditState(store, { workspaces: { personal: registration(join(root, 'gone')) } });

      expect(reportStatus().workspaceStatuses[0]?.problems).toEqual([{ kind: 'workspace-unreachable' }]);
    });
  });

  describe('stray entries', () => {
    it('files each non-skill entry of the store as a problem, sorted, and in neither skills nor notDeployed', async () => {
      const { reportStatus, store } = await newUseCase();

      storeSkill(store, 'triage');
      newDirectory(store.paths.skills, 'drafts');
      writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

      const { storeStatus } = reportStatus();

      expect(storeStatus.problems).toEqual([
        { kind: 'stray-entry', entry: 'drafts' },
        { kind: 'stray-entry', entry: 'notes.txt' },
      ]);
      expect(storeStatus.skills).toEqual(['triage']);
      expect(storeStatus.notDeployed).toEqual(['triage']);
    });

    it('files a symlink cycle as a problem, and leaves it out of skills', async () => {
      const { reportStatus, store } = await newUseCase();
      const loop = join(store.paths.skills, 'loop');

      storeSkill(store, 'triage');
      symlinkSync(loop, loop);

      const { storeStatus } = reportStatus();

      expect(storeStatus.problems).toEqual([{ kind: 'stray-entry', entry: 'loop' }]);
      expect(storeStatus.skills).toEqual(['triage']);
    });

    it('adds no problem for an entry matching an ignore glob', async () => {
      const { reportStatus, store } = await newUseCase();

      handEditState(store, { ignore: ['*.txt'] });
      newDirectory(store.paths.skills, 'drafts');
      writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

      expect(reportStatus().storeStatus.problems).toEqual([{ kind: 'stray-entry', entry: 'drafts' }]);
    });
  });

  describe('reading state', () => {
    it('does not create state.json on a fresh store', async () => {
      const { reportStatus, store } = await newUseCase();

      reportStatus();

      expect(existsSync(store.paths.state)).toBe(false);
    });

    it('leaves an existing state.json byte-identical', async () => {
      const { reportStatus, store, root } = await newUseCase();
      const personal = newDirectory(root, 'personal');

      handEditState(store, {
        workspaces: { personal: registration(personal) },
        skills: { triage: { clones: [{ workspace: 'personal' }] } },
      });

      const before = readFileSync(store.paths.state, 'utf8');

      reportStatus();

      expect(readFileSync(store.paths.state, 'utf8')).toBe(before);
    });

    it('refuses a state.json of the wrong shape', async () => {
      const { reportStatus, store } = await newUseCase();

      mkdirSync(dirname(store.paths.state), { recursive: true });
      writeFileSync(store.paths.state, JSON.stringify({ bogus: true }), 'utf8');

      expect(() => reportStatus()).toThrow(InvalidShapeError);
    });

    it('refuses a clone record naming an unregistered workspace', async () => {
      const { reportStatus, store } = await newUseCase();

      handEditState(store, { skills: { triage: { clones: [{ workspace: 'ghost' }] } } });

      expect(() => reportStatus()).toThrow(InvalidShapeError);
    });

    it('refuses a registration that touches the store', async () => {
      const { reportStatus, store } = await newUseCase();

      handEditState(store, { workspaces: { inside: registration(join(store.paths.skills, 'x')) } });

      expect(() => reportStatus()).toThrow(CollidingRegistrationError);
    });

    it('reads state again on every call', async () => {
      const { reportStatus, store, root } = await newUseCase();

      expect(reportStatus().workspaceStatuses).toEqual([]);

      handEditState(store, { workspaces: { personal: registration(newDirectory(root, 'personal')) } });

      expect(reportStatus().workspaceStatuses.map(({ name }) => name)).toEqual(['personal']);
    });
  });
});

type HandEditedState = {
  workspaces?: Record<string, { path: string; autoLink: boolean }>;
  skills?: Record<string, { clones: unknown[] }>;
  ignore?: string[];
};

async function newUseCase() {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));
  const manager = new GrimoireStoreManager(store);

  return { reportStatus: createReportStatusUseCase({ storeManager: manager }), store, manager, root };
}

function newDirectory(parent: string, ...names: string[]): string {
  const path = join(parent, ...names);

  mkdirSync(path, { recursive: true });

  return path;
}

function registration(path: string): { path: string; autoLink: boolean } {
  return { path, autoLink: false };
}

function storeSkill(store: GrimoireStore, name: string): string {
  const path = newDirectory(store.paths.skills, name);

  writeFileSync(join(path, SKILL_MANIFEST), '# skill\n', 'utf8');

  return path;
}

/** Puts a skill in the store and symlinks it into the workspace under `entry`, the way `link` does. */
function linkSkill(params: {
  store: GrimoireStore;
  workspace: string;
  skill: string;
  entry?: string;
}): void {
  const { store, workspace, skill, entry = skill } = params;

  symlinkSync(storeSkill(store, skill), join(workspace, entry));
}

/** A `state.json` written past the manager, for states only a hand-edit can reach. */
function handEditState(store: GrimoireStore, state: HandEditedState): void {
  mkdirSync(dirname(store.paths.state), { recursive: true });
  writeFileSync(store.paths.state, JSON.stringify(state, null, 2), 'utf8');
}
