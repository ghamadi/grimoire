import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextStyle, TextStyler } from '@/lib/text-styler';
import { formatTable, type TableCell } from '@/lib/text-table';
import { GrimoireStore } from '@/domains/grimoire-store';
import { InvalidShapeError } from '@/lib/errors';
import { SKILL_MANIFEST } from '@/domains/skill';
import { buildProgram, type ProgramDependencies } from '@/program';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { getShellWords } from '@test-helpers/shell-words';
import { tempRoot } from '@test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('status', () => {
  it('prints the workspaces, the skills grid, the clones outside workspaces, then the problems', async () => {
    const { run, store } = await newCli();
    const old = await newDirectory('old');

    for (const skill of ['brainstorm', 'deploy', 'notes', 'review', 'triage']) {
      storeSkill(store, skill);
    }

    await run('workspaces', 'add', 'personal', await newDirectory('personal'), '--auto-link');
    await run('workspaces', 'add', 'work', await newDirectory('work'));
    await run('workspaces', 'add', 'scratch', await newDirectory('scratch'));

    const personal = registeredPath(store, 'personal');
    const work = registeredPath(store, 'work');
    const scratch = registeredPath(store, 'scratch');

    await run('link', 'brainstorm', '--to', 'personal');
    await run('link', 'deploy', '--to', 'personal');
    symlinkSync(join(store.paths.skills, 'triage'), join(personal, 'tri'));
    await run('link', 'triage', '--to', 'work');
    await run('clone', 'deploy', 'work');
    mkdirSync(join(work, 'old'));
    recordClone(store, 'old', { workspace: 'work' });
    await run('clone', 'deploy', 'scratch');
    rmSync(scratch, { recursive: true });
    mkdirSync(join(old, 'notes'));
    recordClone(store, 'notes', { path: old });

    const { stdout, stderr } = await run('status');

    expect(stdout).toEqual([
      'Workspaces  3 registered',
      ...table(
        ['NAME', 'MODE', 'STATE', 'PATH'],
        [
          cells('personal', 'auto-link', 'ok', personal),
          cells('scratch', 'manual', 'unreachable', scratch),
          cells('work', 'manual', '1 problem', work),
        ],
      ),
      '',
      `Skills  5 in ${store.paths.skills} · 1 not deployed`,
      ...table(
        ['SKILL', 'personal', 'scratch', 'work'],
        [
          cells('brainstorm', 'link', '?', '·'),
          cells('deploy', 'link', 'clone ?', 'clone'),
          cells('notes', '·', '?', '·'),
          cells('old (not in store)', '·', '?', 'clone'),
          cells('review', '·', '?', '·'),
          cells('triage', 'link as tri', '?', 'link'),
        ],
      ),
      '',
      'Clones outside workspaces  directories recorded by path',
      ...table(['SKILL', 'STATE', 'DIRECTORY'], [cells('notes', 'present', old)]),
      '',
      'Problems  2',
      '',
      '  ! workspace scratch is unreachable',
      `    ${scratch} does not resolve.`,
      '    Make it readable, or unregister it:',
      '      grimoire workspaces remove scratch',
      '',
      '  ! clone of old in workspace work is no longer in the store',
      '    Forget the record:',
      '      grimoire unclone old work',
    ]);
    expect(stderr).toEqual([]);
  });

  describe('the Workspaces table', () => {
    it('prints none registered, and no table, when no workspace is registered', async () => {
      const { run, store } = await newCli();

      const { stdout, stderr } = await run('status');

      expect(stdout).toEqual([
        'Workspaces  none registered',
        '',
        `Skills  0 in ${store.paths.skills}`,
        '',
        'Problems  none ✓',
      ]);
      expect(stderr).toEqual([]);
    });

    it('prints ok, 1 problem and 2 problems as the STATE of a reachable workspace', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'healthy', await newDirectory('healthy'));
      await run('workspaces', 'add', 'one', await newDirectory('one'));
      await run('workspaces', 'add', 'two', await newDirectory('two'));
      recordClone(store, 'gone', { workspace: 'one' });
      recordClone(store, 'gone', { workspace: 'two' });
      recordClone(store, 'lost', { workspace: 'two' });

      expect(sectionLines((await run('status')).stdout, 'Workspaces')).toEqual([
        'Workspaces  3 registered',
        ...table(
          ['NAME', 'MODE', 'STATE', 'PATH'],
          [
            cells('healthy', 'manual', 'ok', registeredPath(store, 'healthy')),
            cells('one', 'manual', '1 problem', registeredPath(store, 'one')),
            cells('two', 'manual', '2 problems', registeredPath(store, 'two')),
          ],
        ),
      ]);
    });

    it('prints unreachable as the STATE of a workspace whose path does not resolve', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'scratch', await newDirectory('scratch'));

      const scratch = registeredPath(store, 'scratch');

      rmSync(scratch, { recursive: true });

      expect(sectionLines((await run('status')).stdout, 'Workspaces')).toEqual([
        'Workspaces  1 registered',
        ...table(
          ['NAME', 'MODE', 'STATE', 'PATH'],
          [cells('scratch', 'manual', 'unreachable', scratch)],
        ),
      ]);
    });
  });

  describe('the Skills grid', () => {
    it('prints each cell kind, with rows sorted by skill and columns by workspace name', async () => {
      const { run, store } = await newCli();

      for (const skill of ['triage', 'notes', 'lint', 'deploy', 'brainstorm']) {
        storeSkill(store, skill);
      }

      await run('workspaces', 'add', 'home', await newDirectory('home'));
      await run('workspaces', 'add', 'away', await newDirectory('away'));

      const home = registeredPath(store, 'home');

      await run('link', 'brainstorm', '--to', 'home');
      symlinkSync(join(store.paths.skills, 'triage'), join(home, 'tri'));
      await run('clone', 'deploy', 'home');
      await run('clone', 'lint', 'home');
      rmSync(join(home, 'lint'), { recursive: true });
      await run('clone', 'deploy', 'away');
      rmSync(registeredPath(store, 'away'), { recursive: true });

      expect(sectionLines((await run('status')).stdout, 'Skills')).toEqual([
        `Skills  5 in ${store.paths.skills} · 2 not deployed`,
        ...table(
          ['SKILL', 'away', 'home'],
          [
            cells('brainstorm', '?', 'link'),
            cells('deploy', 'clone ?', 'clone'),
            cells('lint', '?', 'clone missing'),
            cells('notes', '?', '·'),
            cells('triage', '?', 'link as tri'),
          ],
        ),
      ]);
    });

    it('joins two links to one skill in one cell', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('link', 'triage', '--to', 'personal');
      symlinkSync(join(store.paths.skills, 'triage'), join(registeredPath(store, 'personal'), 'tri'));

      expect(sectionLines((await run('status')).stdout, 'Skills')).toEqual([
        `Skills  1 in ${store.paths.skills}`,
        ...table(['SKILL', 'personal'], [cells('triage', 'link as tri, link')]),
      ]);
    });

    it('adds a not in store row for a present clone and for a missing one', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      mkdirSync(join(registeredPath(store, 'personal'), 'old'));
      recordClone(store, 'old', { workspace: 'personal' });
      recordClone(store, 'gone', { workspace: 'personal' });

      expect(sectionLines((await run('status')).stdout, 'Skills')).toEqual([
        `Skills  0 in ${store.paths.skills}`,
        ...table(
          ['SKILL', 'personal'],
          [cells('gone (not in store)', 'clone missing'), cells('old (not in store)', 'clone')],
        ),
      ]);
    });

    it('adds a not a skill row for a store entry a workspace links to', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'draft');
      storeSkill(store, 'triage');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('link', 'draft', '--to', 'personal');
      await run('link', 'triage', '--to', 'personal');
      rmSync(join(store.paths.skills, 'draft', SKILL_MANIFEST));

      const { stdout, stderr } = await run('status');

      expect(stdout).toEqual([
        'Workspaces  1 registered',
        ...table(
          ['NAME', 'MODE', 'STATE', 'PATH'],
          [cells('personal', 'manual', 'ok', registeredPath(store, 'personal'))],
        ),
        '',
        `Skills  1 in ${store.paths.skills}`,
        ...table(['SKILL', 'personal'], [cells('draft (not a skill)', 'link'), cells('triage', 'link')]),
        '',
        'Problems  1',
        '',
        '  ! store entry draft is not a skill directory',
        `    Move it out of the store, or add it to "ignore" in ${store.paths.state}.`,
      ]);
      expect(stderr).toEqual([]);
    });

    it('says not a skill for a linked name that is also cloned, and keeps not in store for a clone-only one', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'draft');
      storeSkill(store, 'old');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('workspaces', 'add', 'work', await newDirectory('work'));
      await run('link', 'draft', '--to', 'personal');
      await run('clone', 'draft', 'work');
      await run('clone', 'old', 'work');
      rmSync(join(store.paths.skills, 'draft', SKILL_MANIFEST));
      rmSync(join(store.paths.skills, 'old', SKILL_MANIFEST));

      expect(sectionLines((await run('status')).stdout, 'Skills')).toEqual([
        `Skills  0 in ${store.paths.skills}`,
        ...table(
          ['SKILL', 'personal', 'work'],
          [cells('draft (not a skill)', 'link', 'clone'), cells('old (not in store)', '·', 'clone')],
        ),
      ]);
    });

    it('adds the row for a linked entry that ignore hides, with no problem', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      mkdirSync(store.paths.skills, { recursive: true });
      writeFileSync(join(store.paths.skills, '.DS_Store'), '', 'utf8');
      symlinkSync(join(store.paths.skills, '.DS_Store'), join(registeredPath(store, 'personal'), 'ds'));

      const { stdout } = await run('status');

      expect(sectionLines(stdout, 'Skills')).toEqual([
        `Skills  0 in ${store.paths.skills}`,
        ...table(['SKILL', 'personal'], [cells('.DS_Store (not a skill)', 'link as ds')]),
      ]);
      expect(stdout.at(-1)).toBe('Problems  none ✓');
    });

    it('leaves not deployed out of the caption when every skill is deployed', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('link', 'triage', '--to', 'personal');

      expect((await run('status')).stdout).toContain(`Skills  1 in ${store.paths.skills}`);
    });

    it('counts the skills deployed nowhere in the caption', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'brainstorm');
      storeSkill(store, 'review');
      storeSkill(store, 'triage');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('link', 'triage', '--to', 'personal');

      expect((await run('status')).stdout).toContain(
        `Skills  3 in ${store.paths.skills} · 2 not deployed`,
      );
    });

    it('prints the title line alone for an empty store, even with a workspace registered', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));

      expect(sectionLines((await run('status')).stdout, 'Skills')).toEqual([
        `Skills  0 in ${store.paths.skills}`,
      ]);
    });

    it('prints a SKILL-only grid when no workspace is registered', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      storeSkill(store, 'brainstorm');

      expect(sectionLines((await run('status')).stdout, 'Skills')).toEqual([
        `Skills  2 in ${store.paths.skills} · 2 not deployed`,
        ...table(['SKILL'], [cells('brainstorm'), cells('triage')]),
      ]);
    });
  });

  describe('the Clones outside workspaces table', () => {
    it('is absent when no clone is recorded by path', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('clone', 'triage', 'personal');

      expect(sectionLines((await run('status')).stdout, 'Clones outside workspaces')).toEqual([]);
    });

    it('prints present for a clone whose directory is there and missing for one whose is gone', async () => {
      const { run, store } = await newCli();
      const elsewhere = await newDirectory('elsewhere');

      storeSkill(store, 'deploy');
      storeSkill(store, 'notes');
      mkdirSync(join(elsewhere, 'notes'));
      recordClone(store, 'notes', { path: elsewhere });
      recordClone(store, 'deploy', { path: elsewhere });

      expect(sectionLines((await run('status')).stdout, 'Clones outside workspaces')).toEqual([
        'Clones outside workspaces  directories recorded by path',
        ...table(
          ['SKILL', 'STATE', 'DIRECTORY'],
          [cells('deploy', 'missing', elsewhere), cells('notes', 'present', elsewhere)],
        ),
      ]);
    });

    it('marks a present clone of a skill that is not in the store', async () => {
      const { run, store } = await newCli();
      const elsewhere = await newDirectory('elsewhere');

      mkdirSync(join(elsewhere, 'old'));
      recordClone(store, 'old', { path: elsewhere });

      expect(sectionLines((await run('status')).stdout, 'Clones outside workspaces')).toEqual([
        'Clones outside workspaces  directories recorded by path',
        ...table(['SKILL', 'STATE', 'DIRECTORY'], [cells('old (not in store)', 'present', elsewhere)]),
      ]);
    });

    it('orders rows by directory, then skill', async () => {
      const { run, store } = await newCli();
      const [first = '', second = ''] = [await newDirectory('one'), await newDirectory('two')].sort(
        (a, b) => a.localeCompare(b),
      );

      for (const skill of ['brainstorm', 'notes', 'triage']) {
        storeSkill(store, skill);
      }

      recordClone(store, 'triage', { path: second });
      recordClone(store, 'notes', { path: first });
      recordClone(store, 'brainstorm', { path: second });
      recordClone(store, 'triage', { path: first });

      expect(sectionLines((await run('status')).stdout, 'Clones outside workspaces').slice(1)).toEqual(
        table(
          ['SKILL', 'STATE', 'DIRECTORY'],
          [
            cells('notes', 'missing', first),
            cells('triage', 'missing', first),
            cells('brainstorm', 'missing', second),
            cells('triage', 'missing', second),
          ],
        ),
      );
    });
  });

  describe('stray store entries', () => {
    it('prints a non-skill entry in the Problems section', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

      const { stdout, stderr } = await run('status');

      expect(stdout).toEqual([
        'Workspaces  none registered',
        '',
        `Skills  1 in ${store.paths.skills} · 1 not deployed`,
        ...table(['SKILL'], [cells('triage')]),
        '',
        'Problems  1',
        '',
        '  ! store entry notes.txt is not a skill directory',
        `    Move it out of the store, or add it to "ignore" in ${store.paths.state}.`,
      ]);
      expect(stderr).toEqual([]);
    });

    it('counts no skill in a store holding only a stray entry', async () => {
      const { run, store } = await newCli();

      mkdirSync(store.paths.skills, { recursive: true });
      writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

      expect((await run('status')).stdout.slice(2)).toEqual([
        `Skills  0 in ${store.paths.skills}`,
        '',
        'Problems  1',
        '',
        '  ! store entry notes.txt is not a skill directory',
        `    Move it out of the store, or add it to "ignore" in ${store.paths.state}.`,
      ]);
    });

    it('prints nothing for an entry the default ignore hides', async () => {
      const { run, store } = await newCli();

      mkdirSync(store.paths.skills, { recursive: true });
      writeFileSync(join(store.paths.skills, '.DS_Store'), '', 'utf8');

      expect((await run('status')).stdout.slice(2)).toEqual([
        `Skills  0 in ${store.paths.skills}`,
        '',
        'Problems  none ✓',
      ]);
    });
  });

  describe('clone record problems', () => {
    it('prints the clone problems of a workspace with the workspace name as target', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));

      const personal = registeredPath(store, 'personal');

      mkdirSync(join(personal, 'old'));
      recordClone(store, 'old', { workspace: 'personal' });
      recordClone(store, 'gone', { workspace: 'personal' });
      recordClone(store, 'triage', { workspace: 'personal' });

      const { stdout, stderr } = await run('status');

      expect(stdout).toEqual([
        'Workspaces  1 registered',
        ...table(
          ['NAME', 'MODE', 'STATE', 'PATH'],
          [cells('personal', 'manual', '3 problems', personal)],
        ),
        '',
        `Skills  1 in ${store.paths.skills} · 1 not deployed`,
        ...table(
          ['SKILL', 'personal'],
          [
            cells('gone (not in store)', 'clone missing'),
            cells('old (not in store)', 'clone'),
            cells('triage', 'clone missing'),
          ],
        ),
        '',
        'Problems  3',
        '',
        '  ! clone of old in workspace personal is no longer in the store',
        '    Forget the record:',
        '      grimoire unclone old personal',
        '',
        '  ! clone of gone in workspace personal is missing',
        '    Forget the record:',
        '      grimoire unclone gone personal',
        '',
        '  ! clone of triage in workspace personal is missing',
        '    Copy it again:',
        '      grimoire clone triage personal',
        '    Or forget the record:',
        '      grimoire unclone triage personal',
      ]);
      expect(stderr).toEqual([]);
    });

    it('prints the clone problems of a recorded path with the path as location and target', async () => {
      const { run, store } = await newCli();
      const elsewhere = await newDirectory('elsewhere');

      storeSkill(store, 'deploy');
      mkdirSync(join(elsewhere, 'old'));
      recordClone(store, 'old', { path: elsewhere });
      recordClone(store, 'deploy', { path: elsewhere });

      const { stdout, stderr } = await run('status');

      expect(stdout).toEqual([
        'Workspaces  none registered',
        '',
        `Skills  1 in ${store.paths.skills} · 1 not deployed`,
        ...table(['SKILL'], [cells('deploy')]),
        '',
        'Clones outside workspaces  directories recorded by path',
        ...table(
          ['SKILL', 'STATE', 'DIRECTORY'],
          [cells('deploy', 'missing', elsewhere), cells('old (not in store)', 'present', elsewhere)],
        ),
        '',
        'Problems  2',
        '',
        `  ! clone of old in ${elsewhere} is no longer in the store`,
        '    Forget the record:',
        `      grimoire unclone old ${elsewhere}`,
        '',
        `  ! clone of deploy in ${elsewhere} is missing`,
        '    Forget the record:',
        `      grimoire unclone deploy ${elsewhere}`,
      ]);
      expect(stderr).toEqual([]);
    });

    it('refuses a clone record naming an unregistered workspace, printing nothing', async () => {
      const { runRefused, store } = await newCli();

      storeSkill(store, 'triage');
      recordClone(store, 'triage', { workspace: 'ghost' });

      const { error, stdout } = await runRefused('status');

      expect(error).toBeInstanceOf(InvalidShapeError);
      expect(error.message).toContain('skills.triage.clones[0].workspace');
      expect(stdout).toEqual([]);
    });

    it('orders problems by workspace, then recorded path, then store, and counts them in the title', async () => {
      const { run, store } = await newCli();
      const elsewhere = await newDirectory('elsewhere');

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      recordClone(store, 'gone', { workspace: 'personal' });
      recordClone(store, 'deploy', { path: elsewhere });
      mkdirSync(store.paths.skills, { recursive: true });
      writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

      const { stdout } = await run('status');

      expect(stdout).toContain('Problems  3');
      expect(stdout.filter((line) => line.startsWith('  ! '))).toEqual([
        '  ! clone of gone in workspace personal is missing',
        `  ! clone of deploy in ${elsewhere} is missing`,
        '  ! store entry notes.txt is not a skill directory',
      ]);
    });

    it('completes without throwing while problems are present', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      recordClone(store, 'gone', { workspace: 'personal' });

      await expect(run('status')).resolves.not.toThrow();
    });

    it('clears clone-not-in-store with the printed unclone, and its row disappears', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      mkdirSync(join(registeredPath(store, 'personal'), 'old'));
      recordClone(store, 'old', { workspace: 'personal' });

      await run(
        ...printedRemedy(
          (await run('status')).stdout,
          'clone of old in workspace personal is no longer in the store',
        ),
      );

      const { stdout } = await run('status');

      expect(stdout.some((line) => line.includes('is no longer in the store'))).toBe(false);
      expect(stdout.some((line) => line.includes('old (not in store)'))).toBe(false);
    });

    it('clears a recloneable clone-missing with the printed clone, and the cell reads clone', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('clone', 'triage', 'personal');
      rmSync(join(registeredPath(store, 'personal'), 'triage'), { recursive: true });

      await run(
        ...printedRemedy(
          (await run('status')).stdout,
          'clone of triage in workspace personal is missing',
        ),
      );

      const { stdout } = await run('status');

      expect(sectionLines(stdout, 'Skills').slice(1)).toEqual(
        table(['SKILL', 'personal'], [cells('triage', 'clone')]),
      );
      expect(stdout.some((line) => line.includes('is missing'))).toBe(false);
    });

    it('clears a recorded-path clone-missing with the printed unclone, and the section disappears', async () => {
      const { run, store } = await newCli();
      const elsewhere = await newDirectory('elsewhere');

      storeSkill(store, 'deploy');
      recordClone(store, 'deploy', { path: elsewhere });

      await run(
        ...printedRemedy((await run('status')).stdout, `clone of deploy in ${elsewhere} is missing`),
      );

      expect(sectionLines((await run('status')).stdout, 'Clones outside workspaces')).toEqual([]);
    });

    it('clears a recorded-path clone-missing with a space in its path with the printed unclone', async () => {
      const { run, store } = await newCli();
      const spaced = await newDirectory('My Projects');

      storeSkill(store, 'deploy');
      recordClone(store, 'deploy', { path: spaced });

      await run(
        ...printedRemedy((await run('status')).stdout, `clone of deploy in ${spaced} is missing`),
      );

      expect(sectionLines((await run('status')).stdout, 'Clones outside workspaces')).toEqual([]);
    });

    it('quotes the words of a fix command that a shell would split', async () => {
      const { run, store } = await newCli();
      const spaced = await newDirectory('My Projects');

      recordClone(store, 'my notes', { path: spaced });

      const { stdout } = await run('status');

      // Problems is the last section, and a blank line follows its title, so `sectionLines` would stop there.
      expect(stdout.slice(stdout.indexOf('Problems  1'))).toEqual([
        'Problems  1',
        '',
        `  ! clone of my notes in ${spaced} is missing`,
        '    Forget the record:',
        `      grimoire unclone 'my notes' '${spaced}'`,
      ]);
    });
  });

  describe('workspace problems', () => {
    it('clears workspace-unreachable with the printed workspaces remove, and its row disappears', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'scratch', await newDirectory('scratch'));
      rmSync(registeredPath(store, 'scratch'), { recursive: true });

      await run(...printedRemedy((await run('status')).stdout, 'workspace scratch is unreachable'));

      expect((await run('status')).stdout.some((line) => line.startsWith('│ scratch'))).toBe(false);
    });

    describe.skipIf(runsAsRoot)('an unreadable workspace', () => {
      it('prints unreadable as its STATE and the workspace-unreadable entry, and nothing on stderr', async () => {
        const { run, store } = await newCli();

        await run('workspaces', 'add', 'scratch', await newDirectory('scratch'));

        const scratch = registeredPath(store, 'scratch');

        lockDirectory({ path: scratch });

        const { stdout, stderr } = await run('status');

        expect(stdout).toEqual([
          'Workspaces  1 registered',
          ...table(
            ['NAME', 'MODE', 'STATE', 'PATH'],
            [cells('scratch', 'manual', 'unreadable', scratch)],
          ),
          '',
          `Skills  0 in ${store.paths.skills}`,
          '',
          'Problems  1',
          '',
          '  ! workspace scratch is unreadable',
          `    ${scratch} cannot be read.`,
          '    Make it readable, or unregister it anyway:',
          '      grimoire workspaces remove scratch --force',
        ]);
        expect(stderr).toEqual([]);
      });

      it('clears workspace-unreadable with the printed workspaces remove --force, and its row disappears', async () => {
        const { run, store } = await newCli();

        await run('workspaces', 'add', 'scratch', await newDirectory('scratch'));
        lockDirectory({ path: registeredPath(store, 'scratch') });

        await run(...printedRemedy((await run('status')).stdout, 'workspace scratch is unreadable'));

        expect((await run('status')).stdout.some((line) => line.startsWith('│ scratch'))).toBe(false);
      });
    });
  });

  describe('dangling links', () => {
    it('prints the problem in the Problems section, and no grid row for the link', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'brainstorm');
      storeSkill(store, 'triage');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('link', 'brainstorm', '--to', 'personal');
      await run('link', 'triage', '--to', 'personal');
      rmSync(join(store.paths.skills, 'triage'), { recursive: true });

      const { stdout, stderr } = await run('status');

      expect(stdout).toEqual([
        'Workspaces  1 registered',
        ...table(
          ['NAME', 'MODE', 'STATE', 'PATH'],
          [cells('personal', 'manual', '1 problem', registeredPath(store, 'personal'))],
        ),
        '',
        `Skills  1 in ${store.paths.skills}`,
        ...table(['SKILL', 'personal'], [cells('brainstorm', 'link')]),
        '',
        'Problems  1',
        '',
        '  ! link triage in workspace personal resolves nowhere',
        '    It points into the store, at a skill that is not there.',
        '    Delete the link yourself.',
      ]);
      expect(stderr).toEqual([]);
    });
  });

  describe('status colors', () => {
    const taggingTextStyler: TextStyler = (style, text) => `<${style}>${text}</${style}>`;

    it('styles titles, captions, cells by state, problem headlines and fix commands, never paths or sentences', async () => {
      const { store, paths } = await newColorFixture();
      const { run } = await newCli({ store, textStyler: taggingTextStyler });
      const nothing = styled('dim', '·');
      const unknown = styled('dim', '?');

      expect((await run('status')).stdout).toEqual([
        '<bold>Workspaces</bold>  <dim>3 registered</dim>',
        ...table(
          ['NAME', 'MODE', 'STATE', 'PATH'],
          [
            cells('personal', 'auto-link', styled('yellow', '2 problems'), paths.personal),
            cells('scratch', 'manual', styled('yellow', 'unreachable'), paths.scratch),
            cells('work', 'manual', styled('green', 'ok'), paths.work),
          ],
          taggingTextStyler,
        ),
        '',
        `<bold>Skills</bold>  <dim>5 in ${store.paths.skills} · 1 not deployed</dim>`,
        ...table(
          ['SKILL', 'personal', 'scratch', 'work'],
          [
            cells('brainstorm', styled('cyan', 'link'), unknown, nothing),
            cells('deploy', styled('magenta', 'clone'), unknown, nothing),
            cells('notes', nothing, unknown, nothing),
            cells(styled('yellow', 'old (not in store)'), styled('magenta', 'clone'), unknown, nothing),
            cells(styled('dim', 'review'), nothing, unknown, nothing),
            cells('triage', styled('yellow', 'link as tri, clone missing'), unknown, nothing),
          ],
          taggingTextStyler,
        ),
        '',
        '<bold>Clones outside workspaces</bold>  <dim>directories recorded by path</dim>',
        ...table(
          ['SKILL', 'STATE', 'DIRECTORY'],
          [cells('notes', styled('magenta', 'present'), paths.gone)],
          taggingTextStyler,
        ),
        '',
        '<bold>Problems</bold>  <yellow>3</yellow>',
        '',
        '  <yellow>!</yellow> <bold>clone of old in workspace personal is no longer in the store</bold>',
        '    Forget the record:',
        '      <cyan>grimoire unclone old personal</cyan>',
        '',
        '  <yellow>!</yellow> <bold>clone of triage in workspace personal is missing</bold>',
        '    Copy it again:',
        '      <cyan>grimoire clone triage personal</cyan>',
        '    Or forget the record:',
        '      <cyan>grimoire unclone triage personal</cyan>',
        '',
        '  <yellow>!</yellow> <bold>workspace scratch is unreachable</bold>',
        `    ${paths.scratch} does not resolve.`,
        '    Make it readable, or unregister it:',
        '      <cyan>grimoire workspaces remove scratch</cyan>',
      ]);
    });

    it('never moves a column when styling is applied', async () => {
      const { store } = await newColorFixture();
      const tagged = await newCli({ store, textStyler: taggingTextStyler });
      const plain = await newCli({ store, textStyler: plainTextStyler });
      const untag = (line: string) => line.replace(/<\/?(bold|dim|cyan|yellow|green|magenta)>/g, '');

      expect((await tagged.run('status')).stdout.map(untag)).toEqual((await plain.run('status')).stdout);
    });

    it('greens none ✓ when there are no problems', async () => {
      const { run } = await newCli({ textStyler: taggingTextStyler });

      expect((await run('status')).stdout.at(-1)).toBe('<bold>Problems</bold>  <green>none ✓</green>');
    });

    it('yellows clone ? in an unreachable workspace', async () => {
      const { run, store } = await newCli({ textStyler: taggingTextStyler });

      storeSkill(store, 'deploy');
      await run('workspaces', 'add', 'scratch', await newDirectory('scratch'));
      await run('clone', 'deploy', 'scratch');
      rmSync(registeredPath(store, 'scratch'), { recursive: true });

      expect(sectionLines((await run('status')).stdout, '<bold>Skills</bold>').slice(1)).toEqual(
        table(['SKILL', 'scratch'], [cells('deploy', styled('yellow', 'clone ?'))], taggingTextStyler),
      );
    });

    it('yellows a not a skill name and keeps its link cyan', async () => {
      const { run, store } = await newCli({ textStyler: taggingTextStyler });

      storeSkill(store, 'draft');
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      await run('link', 'draft', '--to', 'personal');
      rmSync(join(store.paths.skills, 'draft', SKILL_MANIFEST));

      expect(sectionLines((await run('status')).stdout, '<bold>Skills</bold>').slice(1)).toEqual(
        table(
          ['SKILL', 'personal'],
          [cells(styled('yellow', 'draft (not a skill)'), styled('cyan', 'link'))],
          taggingTextStyler,
        ),
      );
    });
  });

  describe('status width', () => {
    it('wraps the path cell so the Workspaces and Clones outside workspaces tables fit the width', async () => {
      const { runStatus, paths } = await newWidthFixture();
      const unfittedStdout = await runStatus(undefined);
      const unfittedWorkspacesTable = sectionLines(unfittedStdout, 'Workspaces').slice(1);
      const unfittedOutsideClonesTable = sectionLines(unfittedStdout, 'Clones outside workspaces').slice(
        1,
      );
      const width = (unfittedWorkspacesTable[0]?.length ?? 0) - 3;

      const stdout = await runStatus(width);
      const workspacesTable = sectionLines(stdout, 'Workspaces').slice(1);
      const outsideClonesTable = sectionLines(stdout, 'Clones outside workspaces').slice(1);

      expect(workspacesTable.length).toBeGreaterThan(unfittedWorkspacesTable.length);
      expect(outsideClonesTable.length).toBeGreaterThan(unfittedOutsideClonesTable.length);
      expect([...workspacesTable, ...outsideClonesTable].filter((line) => line.length > width)).toEqual(
        [],
      );
      expect(lastColumnTexts(workspacesTable)).toEqual([paths.personal, paths.work]);
      expect(lastColumnTexts(outsideClonesTable)).toEqual([paths.outside]);
    });

    it('stacks the Skills grid into tables that each repeat the SKILL column', async () => {
      const { runStatus } = await newWidthFixture();
      const unfittedSkillsTable = sectionLines(await runStatus(undefined), 'Skills').slice(1);
      const width = (unfittedSkillsTable[0]?.length ?? 0) - 1;

      const skillsTable = sectionLines(await runStatus(width), 'Skills').slice(1);
      const headerRows = skillsTable.filter((_, index) => skillsTable[index - 1]?.startsWith('┌'));

      expect(headerRows).toEqual([
        expect.stringMatching(/^│ SKILL +│ personal +│$/),
        expect.stringMatching(/^│ SKILL +│ work +│$/),
      ]);
      expect(skillsTable.filter((line) => line.length > width)).toEqual([]);
    });

    it('prints a problem line wider than the width whole', async () => {
      const { runStatus } = await newWidthFixture();
      const headline = '  ! store entry readme.txt is not a skill directory';

      expect(await runStatus(headline.length - 20)).toContain(headline);
    });

    it('reads the terminal width once per run', async () => {
      const { runStatus, getTerminalWidth } = await newWidthFixture();

      await runStatus(80);

      expect(getTerminalWidth).toHaveBeenCalledTimes(1);
    });

    it('prints what an unbounded width prints when every table fits', async () => {
      const { runStatus } = await newWidthFixture();

      expect(await runStatus(10_000)).toEqual(await runStatus(undefined));
    });
  });

  it('refuses an argument', async () => {
    const { run } = await newCli();

    const error = await captureError(() => run('status', 'extra'));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.excessArguments');
  });
});

const plainTextStyler: TextStyler = (_style, text) => text;

/** The lines `status` prints for a table, so a test pins its cells and not its box. */
function table(
  headers: string[],
  rows: TableCell[][],
  textStyler: TextStyler = plainTextStyler,
): string[] {
  return formatTable({ headers, rows, textStyler });
}

/** A table row; a bare string is an unstyled cell. */
function cells(...row: (string | TableCell)[]): TableCell[] {
  return row.map((cell) => (typeof cell === 'string' ? { text: cell } : cell));
}

function styled(style: TextStyle, text: string): TableCell {
  return { text, style };
}

/** The section whose title line starts with `title`, up to the blank line that ends it. */
function sectionLines(stdout: string[], title: string): string[] {
  const titleIndex = stdout.findIndex((line) => line.startsWith(`${title}  `));

  if (titleIndex === -1) {
    return [];
  }

  const endIndex = stdout.indexOf('', titleIndex);

  return stdout.slice(titleIndex, endIndex === -1 ? undefined : endIndex);
}

async function newCli(options: ProgramDependencies & { store?: GrimoireStore } = {}) {
  const { store = new GrimoireStore(await tempRoot()), ...dependencies } = options;
  const program = silence(
    buildProgram(store, {
      textStyler: plainTextStyler,
      getTerminalWidth: () => undefined,
      ...dependencies,
    }),
  );

  /** What the command printed, and what it threw, if anything. */
  async function execute(argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let thrown: Error | undefined;

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      await program.parseAsync(argv, { from: 'user' });
    } catch (caught) {
      thrown = caught as Error;
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }

    return { stdout, stderr, thrown };
  }

  async function run(...argv: string[]) {
    const { stdout, stderr, thrown } = await execute(argv);

    if (thrown !== undefined) {
      throw thrown;
    }

    return { stdout, stderr };
  }

  /** The refusal the command threw, with what it printed before throwing. */
  async function runRefused(...argv: string[]) {
    const { stdout, stderr, thrown } = await execute(argv);

    if (thrown === undefined) {
      throw new Error('expected a refusal');
    }

    return { error: thrown, stdout, stderr };
  }

  return { run, runRefused, store };
}

/** A store exercising every styled token. */
async function newColorFixture() {
  const { run, store } = await newCli();
  const gone = await newDirectory('gone');

  for (const skill of ['brainstorm', 'deploy', 'notes', 'review', 'triage']) {
    storeSkill(store, skill);
  }

  await run('workspaces', 'add', 'personal', await newDirectory('personal'), '--auto-link');
  await run('workspaces', 'add', 'scratch', await newDirectory('scratch'));
  await run('workspaces', 'add', 'work', await newDirectory('work'));
  await run('workspaces', 'add', 'gone', gone);

  const paths = {
    personal: registeredPath(store, 'personal'),
    scratch: registeredPath(store, 'scratch'),
    work: registeredPath(store, 'work'),
    gone,
  };

  await run('link', 'brainstorm', '--to', 'personal');
  await run('clone', 'deploy', 'personal');
  mkdirSync(join(paths.personal, 'old'));
  recordClone(store, 'old', { workspace: 'personal' });
  symlinkSync(join(store.paths.skills, 'triage'), join(paths.personal, 'tri'));
  recordClone(store, 'triage', { workspace: 'personal' });
  await run('clone', 'notes', 'gone');
  await run('workspaces', 'remove', 'gone');
  rmSync(paths.scratch, { recursive: true });

  return { store, paths };
}

/**
 * Two workspaces at nested paths, a clone outside them in a directory nested deeper so that its
 * table is the wider one, and a problem. `runStatus` prints `status` at the given terminal width.
 */
async function newWidthFixture() {
  let terminalWidth: number | undefined;
  const getTerminalWidth = vi.fn(() => terminalWidth);
  const { run, store } = await newCli({ getTerminalWidth });
  const outside = await newDirectory('a/b/c/d/e/f/g/h/i/j/outside');

  for (const skill of ['brainstorm', 'deploy', 'notes', 'triage']) {
    storeSkill(store, skill);
  }

  await run('workspaces', 'add', 'personal', await newDirectory('a/b/c/d/personal'));
  await run('workspaces', 'add', 'work', await newDirectory('a/b/c/d/work'));
  await run('link', 'brainstorm', '--to', 'personal');
  await run('link', 'triage', '--to', 'personal');
  await run('link', 'triage', '--to', 'work');
  await run('clone', 'deploy', 'personal');
  await run('clone', 'deploy', 'work');
  mkdirSync(join(outside, 'notes'));
  recordClone(store, 'notes', { path: outside });
  writeFileSync(join(store.paths.skills, 'readme.txt'), 'readme', 'utf8');

  async function runStatus(width: number | undefined): Promise<string[]> {
    terminalWidth = width;

    return (await run('status')).stdout;
  }

  return {
    runStatus,
    getTerminalWidth,
    paths: {
      personal: registeredPath(store, 'personal'),
      work: registeredPath(store, 'work'),
      outside,
    },
  };
}

/** The last column's text for each row of a printed table, a wrapped cell rejoined from its lines. */
function lastColumnTexts(tableLines: string[]): string[] {
  return tableLines.slice(3, -1).reduce<string[]>((texts, line) => {
    const cellTexts = line
      .split('│')
      .slice(1, -1)
      .map((cellText) => cellText.trim());
    const lastCellText = cellTexts.at(-1) ?? '';

    return cellTexts[0] === ''
      ? [...texts.slice(0, -1), `${texts.at(-1) ?? ''}${lastCellText}`]
      : [...texts, lastCellText];
  }, []);
}

/**
 * Makes the whole command tree throw instead of exiting, and keeps commander's
 * own error text out of the test runner's output.
 *
 * Applied to every command rather than just the root: commander copies these
 * settings into a subcommand when `.command()` creates it, so a tree that is
 * fully built before `.exitOverride()` is called never receives them, and
 * `.addCommand()` does not copy them at all.
 */
function silence(program: Command): Command {
  program.exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });

  for (const subcommand of program.commands) {
    silence(subcommand);
  }

  return program;
}

/** The error a refusal threw, so its code can be asserted on. */
async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}

/** A directory to register, outside the store root — a path inside it collides. */
async function newDirectory(name: string): Promise<string> {
  const path = join(await tempRoot(), name);

  mkdirSync(path, { recursive: true });

  return path;
}

function storeSkill(store: GrimoireStore, name: string): void {
  const path = join(store.paths.skills, name);

  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, SKILL_MANIFEST), '# skill\n', 'utf8');
}

/** The path `workspaces add` filed the workspace under, which is what `status` prints. */
function registeredPath(store: GrimoireStore, name: string): string {
  return readState(store).workspaces?.[name]?.path ?? '';
}

/** Appends a clone record to the skill's, keeping whatever `state.json` already holds. */
function recordClone(
  store: GrimoireStore,
  skill: string,
  record: { workspace: string } | { path: string },
): void {
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

function readState(store: GrimoireStore): {
  workspaces?: Record<string, { path: string }>;
  skills?: Record<string, { clones?: unknown[] }>;
} {
  if (!existsSync(store.paths.state)) {
    return {};
  }

  return JSON.parse(readFileSync(store.paths.state, 'utf8')) as ReturnType<typeof readState>;
}

/**
 * The first `grimoire …` command line of the problem entry whose line contains `fragment`,
 * as argv without the program name.
 */
function printedRemedy(stdout: string[], fragment: string): string[] {
  const fragmentIndex = stdout.findIndex((candidate) => candidate.includes(fragment));
  const linesAfterFragment = fragmentIndex === -1 ? [] : stdout.slice(fragmentIndex + 1);
  const entryEndIndex = linesAfterFragment.indexOf('');
  const entryLines =
    entryEndIndex === -1 ? linesAfterFragment : linesAfterFragment.slice(0, entryEndIndex);
  const command = entryLines
    .map((line) => /^ {6}grimoire (.+)$/.exec(line)?.[1])
    .find((match) => match !== undefined);

  if (command === undefined) {
    throw new Error(`no printed remedy after a line containing "${fragment}"`);
  }

  return getShellWords(command);
}
