import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillPicker } from '@/commands/skills/index';
import { GrimoireStore } from '@/domains/grimoire-store/index';
import { SKILL_MANIFEST, type SkillSource } from '@/domains/skill/index';
import {
  AddDeclinedError,
  EntityNotFoundError,
  InvalidPathError,
  NoTerminalError,
  PathCollisionError,
  WorkspaceUnreadableError,
} from '@/lib/errors/index';
import { buildProgram, type ProgramDependencies } from '@/program';
import { tempRoot } from '@test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('skills add', () => {
  it('copies every skill found under a container and confirms each', async () => {
    const { run, store } = await newCli();
    const container = await newDirectory('skills');

    writeSkillDirectory(join(container, 'deploy'), { [SKILL_MANIFEST]: 'deploy manifest' });
    writeSkillDirectory(join(container, 'brainstorm'), { [SKILL_MANIFEST]: 'brainstorm manifest' });

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['added brainstorm', 'added deploy']);
    expect(stderr).toEqual([]);
    expect(readFileSync(join(store.paths.skills, 'brainstorm', SKILL_MANIFEST), 'utf8')).toBe(
      'brainstorm manifest',
    );
    expect(readFileSync(join(store.paths.skills, 'deploy', SKILL_MANIFEST), 'utf8')).toBe(
      'deploy manifest',
    );
  });

  it('adds just the skill when the path is itself a skill directory', async () => {
    const { run, store } = await newCli();
    const skill = writeSkillDirectory(join(await newDirectory('dev'), 'triage'));

    const { stdout } = await run('skills', 'add', skill, '--all');

    expect(stdout).toEqual(['added triage']);
    expect(readdirSync(store.paths.skills)).toEqual(['triage']);
  });

  it('says a source matching the store copy is already in the store', async () => {
    const { run, store } = await newCli();
    const container = await newContainer('triage');

    storeSkill(store, 'triage');

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['already in the store: triage']);
    expect(stderr).toEqual([]);
  });

  it('notes what the store copy holds beyond the source, on stdout', async () => {
    const { run, store } = await newCli();
    const container = await newContainer('triage');

    writeSkillDirectory(join(store.paths.skills, 'triage'), { 'notes.md': 'mine' });

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['already in the store: triage (also holds "notes.md")']);
    expect(stderr).toEqual([]);
  });

  it('warns about a source that differs from the store copy and leaves the copy alone', async () => {
    const { run, store } = await newCli();
    const container = await newDirectory('skills');

    storeSkill(store, 'deploy');
    writeSkillDirectory(join(container, 'deploy'), { [SKILL_MANIFEST]: 'edited' });
    writeSkillDirectory(join(container, 'brainstorm'));

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([
      `warning: could not add deploy: the store holds a different deploy, differing at "SKILL.md" — edit or replace ${join(store.paths.skills, 'deploy')}`,
    ]);
    expect(readFileSync(join(store.paths.skills, 'deploy', SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
  });

  it('exits clean with a message when the container holds no skills', async () => {
    const { run } = await newCli();
    const container = await newContainer();

    const { stdout, stderr } = await run('skills', 'add', container);

    expect(stdout).toEqual([`nothing to add: no skill found under ${container}`]);
    expect(stderr).toEqual([]);
  });

  it('refuses without --all when there is no terminal to choose from', async () => {
    const { run, store } = await newCli();
    const container = await newContainer('brainstorm', 'deploy');

    const error = await captureError(() => run('skills', 'add', container));

    expect(error).toBeInstanceOf(NoTerminalError);
    expect(error.message).toBe(
      `${container} holds 2 skills and no terminal to choose from\n  use --all to add every one`,
    );
    expect(existsSync(store.paths.skills)).toBe(false);
  });

  it('reads "holds 1 skill" when the refusal is over a lone skill', async () => {
    const { run } = await newCli();
    const skill = writeSkillDirectory(join(await newDirectory('dev'), 'triage'));

    const error = await captureError(() => run('skills', 'add', skill));

    expect(error.message).toContain(`${skill} holds 1 skill and no terminal`);
  });

  it('refuses a path inside a store that has never been created', async () => {
    const { run, store } = await newCli();

    const error = await captureError(() => run('skills', 'add', store.paths.skills, '--all'));

    expect(error).toBeInstanceOf(PathCollisionError);
    expect(error.message).toContain(store.paths.root);
  });

  it('refuses a path that does not exist', async () => {
    const { run } = await newCli();
    const missing = join(await newDirectory('dev'), 'missing');

    expect(await captureError(() => run('skills', 'add', missing, '--all'))).toBeInstanceOf(
      InvalidPathError,
    );
  });

  it('escapes as AddDeclinedError when every source is declined', async () => {
    const { run, store } = await newCli();
    const container = await newDirectory('skills');

    storeSkill(store, 'deploy');
    writeSkillDirectory(join(container, 'deploy'), { [SKILL_MANIFEST]: 'edited' });

    const error = await captureError(() => run('skills', 'add', container, '--all'));

    expect(error).toBeInstanceOf(AddDeclinedError);
    expect(readFileSync(join(store.paths.skills, 'deploy', SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
  });

  it('adds only what a terminal picks, without --all', async () => {
    const picker = fakePicker((sources) => sources.filter((source) => source.name === 'brainstorm'));
    const { run, store } = await newCli({ skillPicker: picker });
    const container = await newContainer('brainstorm', 'deploy');

    const { stdout, stderr } = await run('skills', 'add', container);

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([]);
    expect(readdirSync(store.paths.skills)).toEqual(['brainstorm']);
  });

  it('offers the picker every source the crawl found, in crawl order', async () => {
    const picker = fakePicker(() => []);
    const { run } = await newCli({ skillPicker: picker });
    const container = await newContainer('deploy', 'brainstorm');

    await run('skills', 'add', container);

    expect(picker.offered.map((source) => source.name)).toEqual(['brainstorm', 'deploy']);
  });

  it('reports in source order whatever order the picker returns', async () => {
    const picker = fakePicker((sources) => [...sources].reverse());
    const { run } = await newCli({ skillPicker: picker });
    const container = await newContainer('brainstorm', 'deploy');

    const { stdout } = await run('skills', 'add', container);

    expect(stdout).toEqual(['added brainstorm', 'added deploy']);
  });

  it('says so and touches nothing when the picker chooses nothing', async () => {
    const picker = fakePicker(() => []);
    const { run, store } = await newCli({ skillPicker: picker });
    const container = await newContainer('brainstorm', 'deploy');

    const { stdout, stderr } = await run('skills', 'add', container);

    expect(stdout).toEqual(['nothing added: no skill selected']);
    expect(stderr).toEqual([]);
    expect(existsSync(store.paths.skills)).toBe(false);
  });

  it('runs a picked source through the collision rules', async () => {
    const picker = fakePicker((sources) => sources);
    const { run, store } = await newCli({ skillPicker: picker });
    const container = await newContainer('triage');

    storeSkill(store, 'triage');

    const { stdout } = await run('skills', 'add', container);

    expect(stdout).toEqual(['already in the store: triage']);
  });

  it('adopts a skill written inside an auto-link workspace by linking the store copy over it', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');

    writeSkillDirectory(join(personal, 'triage'));
    await registerAutoLink(run, 'personal', personal);

    const { stdout, stderr } = await run('skills', 'add', join(personal, 'triage'), '--all');

    expect(stdout).toEqual(['added triage', 'linked triage → personal']);
    expect(stderr).toEqual([]);
    expect(readlinkSync(join(personal, 'triage'))).toBe(join(store.paths.skills, 'triage'));
  });

  it('adopts a skill that is already in the store, not only one just copied', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');

    storeSkill(store, 'triage');
    writeSkillDirectory(join(personal, 'triage'));
    await registerAutoLink(run, 'personal', personal);

    const { stdout, stderr } = await run('skills', 'add', join(personal, 'triage'), '--all');

    expect(stdout).toEqual(['already in the store: triage', 'linked triage → personal']);
    expect(stderr).toEqual([]);
    expect(readlinkSync(join(personal, 'triage'))).toBe(join(store.paths.skills, 'triage'));
  });

  it('changes nothing on a second run', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const container = await newContainer('brainstorm');

    await registerAutoLink(run, 'personal', personal);
    await run('skills', 'add', container, '--all');

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['already in the store: brainstorm', 'already linked brainstorm → personal']);
    expect(stderr).toEqual([]);
    expect(readlinkSync(join(personal, 'brainstorm'))).toBe(join(store.paths.skills, 'brainstorm'));
  });

  it('stays silent about linking when no workspace is auto-link', async () => {
    const { run } = await newCli();
    const personal = await newDirectory('personal');
    const container = await newContainer('brainstorm');

    await run('workspaces', 'add', 'personal', personal);

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([]);
  });

  it('warns about a declined link and still succeeds', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const container = await newContainer('brainstorm');

    writeSkillDirectory(join(personal, 'brainstorm'), { [SKILL_MANIFEST]: 'edited' });
    await registerAutoLink(run, 'personal', personal);

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([
      `warning: could not link brainstorm → personal: ${join(personal, 'brainstorm')} holds a directory that differs from the store copy at "SKILL.md" — keep it with \`grimoire clone brainstorm personal\`, or delete it yourself`,
    ]);
    expect(existsSync(join(store.paths.skills, 'brainstorm'))).toBe(true);
  });

  it('warns that it left a recorded clone alone, and still succeeds', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const container = await newContainer('brainstorm');
    const cloned = join(personal, 'brainstorm');

    writeSkillDirectory(cloned);
    await registerAutoLink(run, 'personal', personal);
    recordClone(store, 'brainstorm', { workspace: 'personal' });

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([
      `warning: could not link brainstorm → personal: ${cloned} is a clone — unclone it first with \`grimoire unclone brainstorm personal\``,
    ]);
    expect(lstatSync(cloned).isDirectory()).toBe(true);
  });

  it('prints the add and link groups in their pinned order', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const work = await newDirectory('work');
    const container = await newDirectory('skills');

    writeSkillDirectory(join(container, 'alpha'));
    writeSkillDirectory(join(container, 'beta'));
    writeSkillDirectory(join(container, 'gamma'), { [SKILL_MANIFEST]: 'edited' });
    storeSkill(store, 'beta');
    storeSkill(store, 'gamma');
    symlinkSync(join(store.paths.skills, 'beta'), join(personal, 'beta'));
    await registerAutoLink(run, 'personal', personal);
    await registerAutoLink(run, 'work', work);
    rmSync(work, { recursive: true });

    const { stdout, stderr } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual([
      'added alpha',
      'already in the store: beta',
      'linked alpha → personal',
      'already linked beta → personal',
    ]);
    expect(stderr).toEqual([
      `warning: could not add gamma: the store holds a different gamma, differing at "SKILL.md" — edit or replace ${join(store.paths.skills, 'gamma')}`,
      `warning: workspace "work" was skipped: ${work} is not an existing directory`,
    ]);
  });
});

describe('skills list', () => {
  it("prints the store's skills sorted, one per line", async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');
    storeSkill(store, 'brainstorm');
    storeSkill(store, 'deploy');

    const { stdout, stderr } = await run('skills', 'list');

    expect(stdout).toEqual(['brainstorm', 'deploy', 'triage']);
    expect(stderr).toEqual([]);
  });

  it('prints the empty-store message when the store holds no skills', async () => {
    const { run } = await newCli();

    expect((await run('skills', 'list')).stdout).toEqual(['No skills in the store.']);
  });

  it('skips a loose file and a directory with no SKILL.md', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'brainstorm');
    writeFileSync(join(store.paths.skills, 'notes.md'), 'not a skill', 'utf8');
    mkdirSync(join(store.paths.skills, 'draft'));

    expect((await run('skills', 'list')).stdout).toEqual(['brainstorm']);
  });

  it('reaches the same action through the `ls` alias', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'brainstorm');

    expect((await run('skills', 'ls')).stdout).toEqual(['brainstorm']);
  });
});

describe('skills remove', () => {
  it('clears the links into a skill, then reports where its store copy went', async () => {
    const { run, store } = await newCli();
    const work = await newDirectory('work');

    storeSkill(store, 'triage');
    await registerWorkspace(run, 'work', work);
    const link = linkEntry({ workspace: work, store, skill: 'triage' });

    const { stdout, stderr } = await run('skills', 'remove', 'triage');
    const bin = onlyBin(store);

    expect(stdout).toEqual(['unlinked triage → work', `trashed triage → ${bin}`]);
    expect(stderr).toEqual([]);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(join(store.paths.skills, 'triage'))).toBe(false);
    expect(readFileSync(join(bin, 'store', SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
  });

  it('reaches the same action through the `rm` alias', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');

    const { stdout } = await run('skills', 'rm', 'triage');

    expect(stdout).toEqual([`trashed triage → ${onlyBin(store)}`]);
    expect(existsSync(join(store.paths.skills, 'triage'))).toBe(false);
  });

  it('reports each skill in argument order', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'alpha');
    storeSkill(store, 'beta');

    const { stdout } = await run('skills', 'remove', 'beta', 'alpha');
    const [beta, alpha] = ['beta', 'alpha'].map((skill) => binOf(store, skill));

    expect(stdout).toEqual([`trashed beta → ${beta}`, `trashed alpha → ${alpha}`]);
  });

  it('names an entry that is filed under another name than the skill', async () => {
    const { run, store } = await newCli();
    const work = await newDirectory('work');

    storeSkill(store, 'triage');
    await registerWorkspace(run, 'work', work);
    const link = linkEntry({ workspace: work, store, skill: 'triage', entry: 'tri' });

    const { stdout } = await run('skills', 'remove', 'triage');

    expect(stdout).toEqual([
      'unlinked triage → work (entry "tri")',
      `trashed triage → ${onlyBin(store)}`,
    ]);
    expect(existsSync(link)).toBe(false);
  });

  it('leaves an entry named for the skill that resolves into a different store skill', async () => {
    const { run, store } = await newCli();
    const work = await newDirectory('work');

    storeSkill(store, 'triage');
    storeSkill(store, 'other');
    await registerWorkspace(run, 'work', work);
    const link = linkEntry({ workspace: work, store, skill: 'other', entry: 'triage' });

    const { stdout } = await run('skills', 'remove', 'triage');

    expect(stdout).toEqual([`trashed triage → ${onlyBin(store)}`]);
    expect(readlinkSync(link)).toBe(join(store.paths.skills, 'other'));
  });

  it('lists links from several workspaces in workspace-name order', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const work = await newDirectory('work');

    storeSkill(store, 'triage');
    await registerWorkspace(run, 'work', work);
    await registerWorkspace(run, 'personal', personal);
    linkEntry({ workspace: work, store, skill: 'triage' });
    linkEntry({ workspace: personal, store, skill: 'triage' });

    const { stdout } = await run('skills', 'remove', 'triage');

    expect(stdout).toEqual([
      'unlinked triage → personal',
      'unlinked triage → work',
      `trashed triage → ${onlyBin(store)}`,
    ]);
  });

  describe('clones', () => {
    async function clonedSkill() {
      const cli = await newCli();
      const work = await newDirectory('work');
      const dev = await newDirectory('dev');

      storeSkill(cli.store, 'triage');
      await registerWorkspace(cli.run, 'work', work);
      writeSkillDirectory(join(work, 'triage'));
      writeSkillDirectory(join(dev, 'triage'));
      recordClone(cli.store, 'triage', { workspace: 'work' });
      recordClone(cli.store, 'triage', { path: dev });

      return { ...cli, work, dev };
    }

    it('leaves them in place and says so, one line each', async () => {
      const { run, store, work, dev } = await clonedSkill();

      const { stdout } = await run('skills', 'remove', 'triage');
      const bin = onlyBin(store);

      expect(stdout).toEqual([
        `trashed triage → ${bin}`,
        'clones left in place: triage → work',
        `clones left in place: triage → ${dev}`,
      ]);
      expect(existsSync(join(work, 'triage', SKILL_MANIFEST))).toBe(true);
      expect(existsSync(join(dev, 'triage', SKILL_MANIFEST))).toBe(true);
      expect(readdirSync(bin)).toEqual(['store']);
    });

    it('forgets their records under --forget-clones and leaves the directories alone', async () => {
      const { run, store, work, dev } = await clonedSkill();

      const { stdout } = await run('skills', 'remove', 'triage', '--forget-clones');
      const bin = onlyBin(store);
      const state = JSON.parse(readFileSync(store.paths.state, 'utf8')) as {
        skills?: Record<string, unknown>;
      };

      expect(stdout).toEqual([
        `trashed triage → ${bin}`,
        'forgot clone triage → work',
        `forgot clone triage → ${dev}`,
      ]);
      expect(existsSync(join(work, 'triage', SKILL_MANIFEST))).toBe(true);
      expect(existsSync(join(dev, 'triage', SKILL_MANIFEST))).toBe(true);
      expect(readdirSync(bin)).toEqual(['store']);
      expect(state.skills?.['triage']).toBeUndefined();
    });

    it('rejects --remove-clones as an unknown option', async () => {
      const { run, store } = await clonedSkill();

      const error = await captureError(() => run('skills', 'remove', 'triage', '--remove-clones'));

      expect(error).toBeInstanceOf(CommanderError);
      expect((error as CommanderError).message).toContain("unknown option '--remove-clones'");
      expect(existsSync(join(store.paths.skills, 'triage'))).toBe(true);
      expect(trashEntries(store)).toEqual([]);
    });
  });

  it('refuses a skill the store does not hold, printing nothing', async () => {
    const { run, store } = await newCli();

    const error = await captureError(() => run('skills', 'remove', 'ghost'));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no skill named "ghost"');
    expect(trashEntries(store)).toEqual([]);
  });

  it('refuses the whole run when a registered workspace cannot be read', async () => {
    const { run, store } = await newCli();
    const work = await newDirectory('work');

    storeSkill(store, 'triage');
    await registerWorkspace(run, 'work', work);
    rmSync(work, { recursive: true });

    const error = await captureError(() => run('skills', 'remove', 'triage'));

    expect(error).toBeInstanceOf(WorkspaceUnreadableError);
    expect((error as WorkspaceUnreadableError).workspaces).toEqual([
      { name: 'work', path: work, access: 'unresolvable' },
    ]);
    expect(existsSync(join(store.paths.skills, 'triage'))).toBe(true);
    expect(trashEntries(store)).toEqual([]);
  });
});

/**
 * A program wired to a throwaway store, driven in process.
 *
 * `.exitOverride()` turns commander's `process.exit(1)` into a thrown
 * `CommanderError`, and console is spied rather than `configureOutput`-ed
 * because the actions print through console directly.
 */
async function newCli(dependencies: ProgramDependencies = {}) {
  const store = new GrimoireStore(await tempRoot());
  const program = silence(buildProgram(store, dependencies));

  async function run(...argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      await program.parseAsync(argv, { from: 'user' });
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

/** An interactive picker that records what it was offered and returns whatever `choose` selects. */
function fakePicker(
  choose: (sources: SkillSource[]) => SkillSource[],
): SkillPicker & { offered: SkillSource[] } {
  const offered: SkillSource[] = [];

  return {
    offered,
    isInteractive: () => true,
    pick: ({ sources }) => {
      offered.push(...sources);
      return Promise.resolve(choose(sources));
    },
  };
}

/** A skill directory, whose manifest any entry in `files` may override. */
function writeSkillDirectory(path: string, files: Record<string, string> = {}): string {
  mkdirSync(path, { recursive: true });

  for (const [name, content] of Object.entries({ [SKILL_MANIFEST]: '# skill\n', ...files })) {
    writeFileSync(join(path, name), content, 'utf8');
  }

  return path;
}

function storeSkill(store: GrimoireStore, name: string): string {
  return writeSkillDirectory(join(store.paths.skills, name));
}

/** The error a refusal threw, so the whole multi-line message can be asserted on. */
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

/** Registers a workspace through the real command, with auto-link on. */
async function registerAutoLink(
  run: (...argv: string[]) => Promise<unknown>,
  name: string,
  path: string,
) {
  await run('workspaces', 'add', name, path, '--auto-link');
}

/** The plain counterpart to `registerAutoLink`. */
async function registerWorkspace(
  run: (...argv: string[]) => Promise<unknown>,
  name: string,
  path: string,
) {
  await run('workspaces', 'add', name, path);
}

/** A symlink from a workspace entry to a store skill, under a name that need not be the skill's. */
function linkEntry(params: {
  workspace: string;
  store: GrimoireStore;
  skill: string;
  entry?: string;
}): string {
  const { workspace, store, skill, entry } = params;
  const link = join(workspace, entry ?? skill);

  symlinkSync(join(store.paths.skills, skill), link);

  return link;
}

/** Appends a clone record to the skill's, keeping whatever `state.json` already holds. */
function recordClone(
  store: GrimoireStore,
  skill: string,
  record: { workspace: string } | { path: string },
): void {
  const state = JSON.parse(readFileSync(store.paths.state, 'utf8')) as {
    skills?: Record<string, { clones?: unknown[] }>;
  };
  const skills = state.skills ?? {};
  const clones = skills[skill]?.clones ?? [];

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

/** What the trash holds, which is nothing before the first removal creates it. */
function trashEntries(store: GrimoireStore): string[] {
  return existsSync(store.paths.trash) ? readdirSync(store.paths.trash) : [];
}

/** The one trash bin a run left behind, whose name carries a timestamp no test can pin. */
function onlyBin(store: GrimoireStore): string {
  const bins = readdirSync(store.paths.trash);

  expect(bins).toHaveLength(1);
  expect(bins[0]).toMatch(/^triage-\d{8}T\d{6}$/);

  return join(store.paths.trash, bins[0] as string);
}

/** The trash bin holding `skill`, whichever run made it. */
function binOf(store: GrimoireStore, skill: string): string {
  const bin = readdirSync(store.paths.trash).find((name) => name.startsWith(`${skill}-`));

  return join(store.paths.trash, bin as string);
}

/** A directory holding one default skill directory per name, outside the store root. */
async function newContainer(...skillNames: string[]): Promise<string> {
  const path = await newDirectory('skills');

  for (const name of skillNames) {
    writeSkillDirectory(join(path, name));
  }

  return path;
}
