import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextStyler } from '@/lib/text-styler';
import { GrimoireStore } from '@/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '@/domains/skill/index';
import { buildProgram, type ProgramDependencies } from '@/program';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('status', () => {
  it('prints a block per workspace and recorded path, then the store', async () => {
    const { run, store } = await newCli();
    const old = await newDirectory('old');

    for (const skill of ['brainstorm', 'deploy', 'notes', 'old', 'review', 'triage']) {
      storeSkill(store, skill);
    }

    run('workspaces', 'add', 'personal', await newDirectory('personal'), '--auto-link');
    run('workspaces', 'add', 'work', await newDirectory('work'));
    run('workspaces', 'add', 'scratch', await newDirectory('scratch'));

    const personal = registeredPath(store, 'personal');
    const work = registeredPath(store, 'work');
    const scratch = registeredPath(store, 'scratch');

    run('link', 'brainstorm', 'personal');
    run('link', 'deploy', 'personal');
    symlinkSync(join(store.paths.skills, 'triage'), join(personal, 'tri'));
    run('link', 'triage', 'work');
    run('clone', 'deploy', 'work');
    mkdirSync(join(work, 'old'));
    recordClone(store, 'old', { workspace: 'work' });
    run('clone', 'deploy', 'scratch');
    rmSync(scratch, { recursive: true });
    mkdirSync(join(old, 'notes'));
    recordClone(store, 'notes', { path: old });

    const { stdout, stderr } = run('status');

    expect(stdout).toEqual([
      `personal  auto-link  ${personal}`,
      '  linked   brainstorm, deploy, triage (entry "tri")',
      '',
      `scratch   manual     ${scratch}`,
      '  cloned   deploy',
      `  problem  ${scratch} does not resolve — make it readable, or unregister it with \`grimoire workspaces remove scratch\``,
      '',
      `work      manual     ${work}`,
      '  linked   triage',
      '  cloned   deploy, old',
      '',
      `${old}  recorded by path`,
      '  cloned   notes',
      '',
      `store     ${store.paths.skills}`,
      '  not deployed  review',
    ]);
    expect(stderr).toEqual([]);
  });

  it('says no workspace is registered, and pads the store heading to its own name', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');

    const { stdout, stderr } = run('status');

    expect(stdout).toEqual([
      'No workspaces registered.',
      '',
      `store  ${store.paths.skills}`,
      '  not deployed  triage',
    ]);
    expect(stderr).toEqual([]);
  });

  it('says nothing is deployed in a reachable workspace holding nothing', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');
    run('workspaces', 'add', 'personal', await newDirectory('personal'));

    const { stdout, stderr } = run('status');

    expect(stdout).toEqual([
      `personal  manual     ${registeredPath(store, 'personal')}`,
      '  nothing deployed',
      '',
      `store     ${store.paths.skills}`,
      '  not deployed  triage',
    ]);
    expect(stderr).toEqual([]);
  });

  it('says the store holds no skills', async () => {
    const { run, store } = await newCli();

    const { stdout, stderr } = run('status');

    expect(stdout).toEqual([
      'No workspaces registered.',
      '',
      `store  ${store.paths.skills}`,
      '  no skills',
    ]);
    expect(stderr).toEqual([]);
  });

  it('prints only the store heading when every skill is deployed', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');
    run('workspaces', 'add', 'personal', await newDirectory('personal'));
    run('link', 'triage', 'personal');

    expect(run('status').stdout.at(-1)).toBe(`store     ${store.paths.skills}`);
  });

  describe('stray store entries', () => {
    it('prints a non-skill entry in the store block, after not deployed', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

      const { stdout, stderr } = run('status');

      expect(stdout).toEqual([
        'No workspaces registered.',
        '',
        `store  ${store.paths.skills}`,
        '  not deployed  triage',
        `  problem  notes.txt is not a skill directory — move it out of the store, or add it to "ignore" in ${store.paths.state}`,
      ]);
      expect(stderr).toEqual([]);
    });

    it('prints no skills, then the problem, for a store holding only a stray entry', async () => {
      const { run, store } = await newCli();

      mkdirSync(store.paths.skills, { recursive: true });
      writeFileSync(join(store.paths.skills, 'notes.txt'), 'notes', 'utf8');

      expect(run('status').stdout.slice(2)).toEqual([
        `store  ${store.paths.skills}`,
        '  no skills',
        `  problem  notes.txt is not a skill directory — move it out of the store, or add it to "ignore" in ${store.paths.state}`,
      ]);
    });

    it('prints nothing for an entry the default ignore hides', async () => {
      const { run, store } = await newCli();

      mkdirSync(store.paths.skills, { recursive: true });
      writeFileSync(join(store.paths.skills, '.DS_Store'), '', 'utf8');

      expect(run('status').stdout.slice(2)).toEqual([`store  ${store.paths.skills}`, '  no skills']);
    });
  });

  describe('clone record problems', () => {
    it('prints the clone problems of a workspace block after cloned, with the workspace name as target', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      run('workspaces', 'add', 'personal', await newDirectory('personal'));

      const personal = registeredPath(store, 'personal');

      mkdirSync(join(personal, 'old'));
      recordClone(store, 'old', { workspace: 'personal' });
      recordClone(store, 'gone', { workspace: 'personal' });
      recordClone(store, 'triage', { workspace: 'personal' });

      const { stdout, stderr } = run('status');

      expect(stdout).toEqual([
        `personal  manual     ${personal}`,
        '  cloned   old',
        '  problem  old is no longer in the store — forget the record with `grimoire unclone old personal`',
        '  problem  the clone of gone is missing — forget it with `grimoire unclone gone personal`',
        '  problem  the clone of triage is missing — copy it again with `grimoire clone triage personal`, or forget it with `grimoire unclone triage personal`',
        '',
        `store     ${store.paths.skills}`,
        '  not deployed  triage',
      ]);
      expect(stderr).toEqual([]);
    });

    it('prints the clone problems of a recorded-path block with the path as target', async () => {
      const { run, store } = await newCli();
      const elsewhere = await newDirectory('elsewhere');

      storeSkill(store, 'deploy');
      mkdirSync(join(elsewhere, 'old'));
      recordClone(store, 'old', { path: elsewhere });
      recordClone(store, 'deploy', { path: elsewhere });

      const { stdout, stderr } = run('status');

      expect(stdout).toEqual([
        'No workspaces registered.',
        '',
        `${elsewhere}  recorded by path`,
        '  cloned   old',
        `  problem  old is no longer in the store — forget the record with \`grimoire unclone old ${elsewhere}\``,
        `  problem  the clone of deploy is missing — forget it with \`grimoire unclone deploy ${elsewhere}\``,
        '',
        `store  ${store.paths.skills}`,
        '  not deployed  deploy',
      ]);
      expect(stderr).toEqual([]);
    });

    it('prints a record naming an unregistered workspace in the store block, after not deployed', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      recordClone(store, 'triage', { workspace: 'ghost' });

      const { stdout, stderr } = run('status');

      expect(stdout).toEqual([
        'No workspaces registered.',
        '',
        `store  ${store.paths.skills}`,
        '  not deployed  triage',
        `  problem  a clone of triage is recorded under "ghost", which is not registered — remove it from ${store.paths.state}`,
      ]);
      expect(stderr).toEqual([]);
    });

    it('completes without throwing while problems are present', async () => {
      const { run, store } = await newCli();

      run('workspaces', 'add', 'personal', await newDirectory('personal'));
      recordClone(store, 'gone', { workspace: 'personal' });
      recordClone(store, 'gone', { workspace: 'ghost' });

      expect(() => run('status')).not.toThrow();
    });

    it('clears clone-not-in-store with the printed unclone', async () => {
      const { run, store } = await newCli();

      run('workspaces', 'add', 'personal', await newDirectory('personal'));
      mkdirSync(join(registeredPath(store, 'personal'), 'old'));
      recordClone(store, 'old', { workspace: 'personal' });

      run(...printedRemedy(run('status').stdout, 'old is no longer in the store'));

      const { stdout } = run('status');

      expect(stdout.some((line) => line.includes('old is no longer in the store'))).toBe(false);
      expect(stdout.some((line) => line.includes('cloned'))).toBe(false);
    });

    it('clears a recloneable clone-missing with the printed clone, and the skill reappears under cloned', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      run('workspaces', 'add', 'personal', await newDirectory('personal'));
      run('clone', 'triage', 'personal');
      rmSync(join(registeredPath(store, 'personal'), 'triage'), { recursive: true });

      run(...printedRemedy(run('status').stdout, 'the clone of triage is missing'));

      const { stdout } = run('status');

      expect(stdout).toContain('  cloned   triage');
      expect(stdout.some((line) => line.includes('is missing'))).toBe(false);
    });

    it('clears a recorded-path clone-missing with the printed unclone, and the block disappears', async () => {
      const { run, store } = await newCli();
      const elsewhere = await newDirectory('elsewhere');

      storeSkill(store, 'deploy');
      recordClone(store, 'deploy', { path: elsewhere });

      run(...printedRemedy(run('status').stdout, 'the clone of deploy is missing'));

      expect(run('status').stdout.some((line) => line.includes('recorded by path'))).toBe(false);
    });
  });

  describe('workspace problems', () => {
    it('clears workspace-unreachable with the printed workspaces remove, and the block disappears', async () => {
      const { run, store } = await newCli();

      run('workspaces', 'add', 'scratch', await newDirectory('scratch'));
      rmSync(registeredPath(store, 'scratch'), { recursive: true });

      run(...printedRemedy(run('status').stdout, 'does not resolve'));

      expect(run('status').stdout.some((line) => line.startsWith('scratch'))).toBe(false);
    });

    describe.skipIf(runsAsRoot)('an unreadable workspace', () => {
      it('prints its heading and the workspace-unreadable problem, and nothing on stderr', async () => {
        const { run, store } = await newCli();

        run('workspaces', 'add', 'scratch', await newDirectory('scratch'));

        const scratch = registeredPath(store, 'scratch');

        lockDirectory({ path: scratch });

        const { stdout, stderr } = run('status');

        expect(stdout).toContain(`scratch  manual     ${scratch}`);
        expect(stdout).toContain(
          `  problem  ${scratch} cannot be read — make it readable, or unregister it anyway with \`grimoire workspaces remove scratch --force\``,
        );
        expect(stderr).toEqual([]);
      });

      it('clears workspace-unreadable with the printed workspaces remove --force, and the block disappears', async () => {
        const { run, store } = await newCli();

        run('workspaces', 'add', 'scratch', await newDirectory('scratch'));
        lockDirectory({ path: registeredPath(store, 'scratch') });

        run(...printedRemedy(run('status').stdout, 'cannot be read'));

        expect(run('status').stdout.some((line) => line.startsWith('scratch'))).toBe(false);
      });
    });
  });

  describe('dangling links', () => {
    it('prints the problem in the workspace block after linked', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'brainstorm');
      storeSkill(store, 'triage');
      run('workspaces', 'add', 'personal', await newDirectory('personal'));
      run('link', 'brainstorm', 'personal');
      run('link', 'triage', 'personal');
      rmSync(join(store.paths.skills, 'triage'), { recursive: true });

      const { stdout, stderr } = run('status');

      expect(stdout).toEqual([
        `personal  manual     ${registeredPath(store, 'personal')}`,
        '  linked   brainstorm',
        '  problem  triage is a link into the store that resolves nowhere — delete it yourself',
        '',
        `store     ${store.paths.skills}`,
      ]);
      expect(stderr).toEqual([]);
    });

    it('does not say nothing is deployed when a dangling link is all the workspace holds', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');
      run('workspaces', 'add', 'personal', await newDirectory('personal'));
      run('link', 'triage', 'personal');
      rmSync(join(store.paths.skills, 'triage'), { recursive: true });

      const { stdout } = run('status');

      expect(stdout).toContain(
        '  problem  triage is a link into the store that resolves nowhere — delete it yourself',
      );
      expect(stdout).not.toContain('  nothing deployed');
    });
  });

  describe('status colors', () => {
    const taggingTextStyler: TextStyler = (style, text) => `<${style}>${text}</${style}>`;

    it('styles labels and block names, never content', async () => {
      const { store, paths } = await newColorFixture();
      const { run } = await newCli({ store, textStyler: taggingTextStyler });

      expect(run('status').stdout).toEqual([
        `<bold>personal</bold>  <dim>auto-link</dim>  <dim>${paths.personal}</dim>`,
        '  <cyan>linked</cyan>   brainstorm',
        '  <cyan>cloned</cyan>   deploy',
        '',
        `<bold>scratch</bold>   <dim>manual</dim>     <dim>${paths.scratch}</dim>`,
        '  <yellow>problem</yellow>  ' +
          `${paths.scratch} does not resolve — make it readable, or unregister it with \`grimoire workspaces remove scratch\``,
        '',
        `<bold>${paths.gone}</bold>  <dim>recorded by path</dim>`,
        '  <cyan>cloned</cyan>   notes',
        '',
        `<bold>store</bold>     <dim>${store.paths.skills}</dim>`,
        '  <dim>not deployed</dim>  review',
      ]);
    });

    it('never moves a column when styling is applied', async () => {
      const { store } = await newColorFixture();
      const styled = await newCli({ store, textStyler: taggingTextStyler });
      const plain = await newCli({ store, textStyler: plainTextStyler });
      const untag = (line: string) => line.replace(/<\/?(bold|dim|cyan|yellow)>/g, '');

      expect(styled.run('status').stdout.map(untag)).toEqual(plain.run('status').stdout);
    });

    it('dims nothing deployed', async () => {
      const { run } = await newCli({ textStyler: taggingTextStyler });

      run('workspaces', 'add', 'personal', await newDirectory('personal'));

      expect(run('status').stdout).toContain('  <dim>nothing deployed</dim>');
    });

    it('dims no skills, and leaves No workspaces registered. plain', async () => {
      const { run } = await newCli({ textStyler: taggingTextStyler });

      const { stdout } = run('status');

      expect(stdout[0]).toBe('No workspaces registered.');
      expect(stdout).toContain('  <dim>no skills</dim>');
    });
  });

  it('refuses an argument', async () => {
    const { run } = await newCli();

    const error = captureError(() => run('status', 'extra'));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.excessArguments');
  });
});

const plainTextStyler: TextStyler = (_style, text) => text;

async function newCli(options: ProgramDependencies & { store?: GrimoireStore } = {}) {
  const { store = new GrimoireStore(await tempRoot()), ...dependencies } = options;
  const program = silence(buildProgram(store, { textStyler: plainTextStyler, ...dependencies }));

  function run(...argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      program.parse(argv, { from: 'user' });
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }

    return { stdout, stderr };
  }

  return { run, store };
}

/**
 * A store exercising every styled token: a reachable workspace with a link and
 * a clone, an unreachable one, a recorded path, and a skill deployed nowhere.
 * Workspace names differ in length so padding shows up outside the tags.
 */
async function newColorFixture() {
  const { run, store } = await newCli();
  const gone = await newDirectory('gone');

  for (const skill of ['brainstorm', 'deploy', 'notes', 'review']) {
    storeSkill(store, skill);
  }

  run('workspaces', 'add', 'personal', await newDirectory('personal'), '--auto-link');
  run('workspaces', 'add', 'scratch', await newDirectory('scratch'));
  run('workspaces', 'add', 'gone', gone);
  run('link', 'brainstorm', 'personal');
  run('clone', 'deploy', 'personal');
  run('clone', 'notes', 'gone');
  run('workspaces', 'remove', 'gone');

  const paths = {
    personal: registeredPath(store, 'personal'),
    scratch: registeredPath(store, 'scratch'),
    gone,
  };

  rmSync(paths.scratch, { recursive: true });

  return { store, paths };
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
function captureError(operation: () => unknown): Error {
  try {
    operation();
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

/** The first `grimoire …` command the problem line containing `fragment` prints, as argv without the program name. */
function printedRemedy(stdout: string[], fragment: string): string[] {
  const line = stdout.find((candidate) => candidate.includes(fragment));
  const command = line?.match(/`grimoire ([^`]+)`/)?.[1];

  if (command === undefined) {
    throw new Error(`no printed remedy on a line containing "${fragment}"`);
  }

  return command.split(' ');
}
