import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore } from '#src/domains/grimoire-store/index';
import {
  CollidingRegistrationError,
  DuplicateNameError,
  EntityNotFoundError,
  InvalidWorkspaceNameError,
  InvalidPathError,
  PathCollisionError,
  WorkspaceInUseError,
} from '#src/lib/errors/index';
import { buildProgram } from '#src/program';
import { tempRoot } from '#test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

it('has no alias for the old singular name', async () => {
  const { run } = await newCli();

  expect(captureError(() => run('workspace', 'list'))).toBeInstanceOf(CommanderError);
});

describe('workspaces add', () => {
  it('confirms the registration on stdout', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    const { stdout } = run('workspaces', 'add', 'personal', path);

    expect(stdout).toEqual([`registered workspace "personal" \u2192 ${path} (manual)`]);
    expect(readWorkspaces(store).personal).toEqual({ path, autoLink: false });
  });

  it('honors --auto-link', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    const { stdout } = run('workspaces', 'add', 'personal', path, '--auto-link');

    expect(stdout).toEqual([`registered workspace "personal" \u2192 ${path} (auto-link)`]);
    expect(readWorkspaces(store).personal).toEqual({ path, autoLink: true });
  });

  // A created directory is a result, not a warning: it belongs on stdout.
  it('announces a directory it had to create, above the confirmation', async () => {
    const { run } = await newCli();
    const path = join(await newDirectory('project'), 'skills');

    const { stdout, stderr } = run('workspaces', 'add', 'personal', path);

    expect(stdout).toEqual([
      `created ${path}`,
      `registered workspace "personal" \u2192 ${path} (manual)`,
    ]);
    expect(stderr).toEqual([]);
  });

  it('says nothing about creation when the directory was already there', async () => {
    const { run } = await newCli();

    const { stdout } = run('workspaces', 'add', 'personal', await newDirectory('project'));

    expect(stdout).toHaveLength(1);
  });

  // What lands in state.json is what every later command resolves, so the
  // spelling is normalized before it is stored rather than on each read.
  it('registers the path it normalized rather than the one typed', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    const { stdout } = run('workspaces', 'add', 'personal', `${path}/../project/`);

    expect(stdout).toEqual([`registered workspace "personal" \u2192 ${path} (manual)`]);
    expect(readWorkspaces(store).personal?.path).toBe(path);
  });

  it('keeps the workspaces already registered', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const work = await newDirectory('work');

    run('workspaces', 'add', 'personal', personal);
    run('workspaces', 'add', 'work', work);

    expect(readWorkspaces(store)).toEqual({
      personal: { path: personal, autoLink: false },
      work: { path: work, autoLink: false },
    });
  });

  describe('refusals', () => {
    it('refuses a name outside the allowed alphabet, leaving its path alone', async () => {
      const { run, store } = await newCli();
      const path = await newDirectory('project');

      const error = captureError(() => run('workspaces', 'add', 'a/b', path));

      expect(error).toBeInstanceOf(InvalidWorkspaceNameError);
      expect(error.message).toBe(
        'workspace name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"',
      );
      expect(readWorkspaces(store)).toEqual({});
      expect(existsSync(path)).toBe(true);
    });

    it('refuses a name that is already registered, leaving its path alone', async () => {
      const { run, store } = await newCli();
      const taken = await newDirectory('taken');

      run('workspaces', 'add', 'personal', taken);

      const path = join(await newDirectory('project'), 'skills');
      const error = captureError(() => run('workspaces', 'add', 'personal', path));

      expect(error).toBeInstanceOf(DuplicateNameError);
      expect(error.message).toBe('workspace "personal" is already registered');
      expect(readWorkspaces(store).personal?.path).toBe(taken);
      expect(existsSync(path)).toBe(false);
    });

    it('refuses a relative path, echoing it as typed', async () => {
      const { run, store } = await newCli();

      const error = captureError(() => run('workspaces', 'add', 'personal', 'project/skills'));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe('project/skills must be an absolute path or start with ~/');
      expect(readWorkspaces(store)).toEqual({});
    });

    it('refuses a path held by a file', async () => {
      const { run } = await newCli();
      const path = join(await newDirectory('project'), 'notes.txt');

      writeFileSync(path, '');

      expect(captureError(() => run('workspaces', 'add', 'personal', path)).message).toBe(
        `${path} is not a directory`,
      );
    });

    // Registering the link rather than what it points at would put the workspace
    // wherever the link is repointed next.
    it('refuses a symlinked path rather than following it', async () => {
      const { run } = await newCli();
      const target = await newDirectory('target');
      const path = join(dirname(target), 'skills');

      symlinkSync(target, path);

      expect(captureError(() => run('workspaces', 'add', 'personal', path)).message).toBe(
        `${path} is a symlink`,
      );
    });

    // Only the final segment is created, so a typo in the parent surfaces as one
    // rather than materializing a tree.
    it('refuses a missing parent by name, creating nothing', async () => {
      const { run } = await newCli();
      const parent = join(await newDirectory('project'), 'claude');

      const error = captureError(() => run('workspaces', 'add', 'personal', join(parent, 'skills')));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe(`${parent} does not exist`);
      expect(existsSync(parent)).toBe(false);
    });

    it('refuses a path sitting inside the store', async () => {
      const { run, store } = await newCli();
      const path = join(store.paths.skills, 'personal');

      const error = captureError(() => run('workspaces', 'add', 'personal', path));

      expect(error).toBeInstanceOf(PathCollisionError);
      expect(error.message).toBe(`${path} sits inside the grimoire store (${store.paths.root})`);
      expect(existsSync(path)).toBe(false);
    });

    it('refuses the store root itself', async () => {
      const { run, store } = await newCli();

      expect(captureError(() => run('workspaces', 'add', 'personal', store.paths.root)).message).toBe(
        `${store.paths.root} is the same directory as the grimoire store (${store.paths.root})`,
      );
    });

    it('refuses a path the store sits inside', async () => {
      const { run, store } = await newCli();
      const path = dirname(store.paths.root);

      expect(captureError(() => run('workspaces', 'add', 'personal', path)).message).toBe(
        `${path} contains the grimoire store (${store.paths.root})`,
      );
    });

    it('refuses an invocation naming no path', async () => {
      const { run, store } = await newCli();

      const error = captureError(() => run('workspaces', 'add', 'personal'));

      expect(error).toBeInstanceOf(CommanderError);
      expect(readWorkspaces(store)).toEqual({});
    });
  });
});

describe('workspaces list', () => {
  it('prints name, auto-link, and path in columns', async () => {
    const { run } = await newCli();
    const personal = await newDirectory('personal');
    const work = await newDirectory('work');

    run('workspaces', 'add', 'personal', personal, '--auto-link');
    run('workspaces', 'add', 'work', work);

    expect(run('workspaces', 'list').stdout).toEqual([
      `personal  auto-link  ${personal}`,
      `work      manual     ${work}`,
    ]);
  });

  it('says so when nothing is registered', async () => {
    const { run } = await newCli();

    expect(run('workspaces', 'list').stdout).toEqual(['No workspaces registered.']);
  });

  // state.json holds an object, so registration order is what a naive read
  // prints; the column is sorted so a name lands in the same place every run.
  it('sorts by name rather than by registration order', async () => {
    const { run } = await newCli();
    const work = await newDirectory('work');
    const personal = await newDirectory('personal');

    run('workspaces', 'add', 'work', work);
    run('workspaces', 'add', 'personal', personal);

    // The auto-link column is padded to the widest label, not the widest value,
    // so the path column starts in the same place whatever is registered.
    expect(run('workspaces', 'list').stdout).toEqual([
      `personal  manual     ${personal}`,
      `work      manual     ${work}`,
    ]);
  });

  it('answers to ls identically', async () => {
    const { run } = await newCli();

    run('workspaces', 'add', 'personal', await newDirectory('personal'));

    expect(run('workspaces', 'ls').stdout).toEqual(run('workspaces', 'list').stdout);
  });
});

describe('workspaces remove', () => {
  it('unregisters without touching the directory', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);

    const { stdout } = run('workspaces', 'remove', 'personal');

    expect(stdout).toEqual([`unregistered workspace "personal" → ${path}`]);
    expect(readWorkspaces(store)).toEqual({});
    expect(existsSync(path)).toBe(true);
  });

  it('refuses a name that is not registered', async () => {
    const { run } = await newCli();

    const error = captureError(() => run('workspaces', 'remove', 'personal'));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no workspace named "personal"');
  });

  it('answers to rm identically', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);
    const viaRm = run('workspaces', 'rm', 'personal');

    const stateAfterRm = readFileSync(store.paths.state, 'utf8');

    run('workspaces', 'add', 'personal', path);
    const viaRemove = run('workspaces', 'remove', 'personal');

    expect(viaRm.stdout).toEqual(viaRemove.stdout);
    expect(readFileSync(store.paths.state, 'utf8')).toBe(stateAfterRm);
  });

  it('refuses while links still point at the workspace, naming all of them', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);
    link({ store, workspacePath: path, skill: 'triage' });
    link({ store, workspacePath: path, skill: 'brainstorm' });

    const error = captureError(() => run('workspaces', 'remove', 'personal'));

    expect(error).toBeInstanceOf(WorkspaceInUseError);
    expect(error.message).toBe(
      [
        'workspace "personal" is still in use',
        '  links: brainstorm, triage',
        '  use --hard to clear them',
      ].join('\n'),
    );
  });

  it('reports the clone records it rewrote to a path', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);
    mkdirSync(join(path, 'deploy'));
    recordClones(store, { deploy: [{ workspace: 'personal' }] });

    const { stdout } = run('workspaces', 'remove', 'personal');

    expect(stdout).toEqual([
      '1 clone now recorded by path: deploy',
      `unregistered workspace "personal" → ${path}`,
    ]);
    expect(readClones(store).deploy).toEqual([{ path }]);
  });

  it('reports what --hard cleared and what it left behind', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);
    link({ store, workspacePath: path, skill: 'triage' });
    link({ store, workspacePath: path, skill: 'brainstorm' });
    mkdirSync(join(path, 'deploy'));
    recordClones(store, { deploy: [{ workspace: 'personal' }] });

    const { stdout } = run('workspaces', 'remove', 'personal', '--hard');

    expect(stdout).toEqual([
      'removed 2 links: brainstorm, triage',
      'forgot 1 clone record: deploy',
      `unregistered workspace "personal" → ${path}`,
      'cloned directories were left in place',
    ]);
    expect(existsSync(join(path, 'deploy'))).toBe(true);
  });

  // The registry refuses to load the entry at all, so every command is stopped
  // until it is gone. Nothing here clears it: repairing state.json is not what
  // `remove` is for, and no command does it yet.
  it('refuses a registered path sitting inside the store, naming the file to fix', async () => {
    const { run, store } = await newCli();
    const path = registerColliding(store);

    const error = captureError(() => run('workspaces', 'remove', 'personal'));

    expect(error).toBeInstanceOf(CollidingRegistrationError);
    expect(error.message).toBe(
      [
        `workspace "personal" cannot be used: ${path} sits inside the grimoire store (${store.paths.root})`,
        `  no command can run until it is gone from ${store.paths.state}`,
      ].join('\n'),
    );
  });

  it('refuses every other command while the entry is registered', async () => {
    const { run, store } = await newCli();
    const workspacePath = await newDirectory('project');

    registerColliding(store);

    expect(captureError(() => run('workspaces', 'list'))).toBeInstanceOf(CollidingRegistrationError);
    expect(captureError(() => run('workspaces', 'add', 'work', workspacePath))).toBeInstanceOf(
      CollidingRegistrationError,
    );
  });
});

/**
 * A program wired to a throwaway store, driven in process.
 *
 * `.exitOverride()` turns commander's `process.exit(1)` into a thrown
 * `CommanderError`, and console is spied rather than `configureOutput`-ed
 * because the actions print through console directly.
 */
async function newCli() {
  const store = new GrimoireStore(await tempRoot());
  const program = silence(buildProgram(store));

  function run(...argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation((line: string) => void stderr.push(line));

    try {
      program.parse(argv, { from: 'user' });
    } finally {
      log.mockRestore();
      error.mockRestore();
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

/** The error a refusal threw, so the whole multi-line message can be asserted on. */
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

type CloneRecord = { workspace: string } | { path: string };

/** state.json as it sits on disk, carrying only the sections these tests touch. */
type StoredDocument = {
  workspaces?: Record<string, { path: string; autoLink: boolean }>;
  skills?: Record<string, { clones: CloneRecord[] }>;
};

/**
 * The registry as state.json holds it, keyed by name.
 *
 * Read off disk rather than through the manager, so an assertion about what was
 * written cannot be satisfied by the code that wrote it.
 */
function readWorkspaces(store: GrimoireStore): Record<string, { path: string; autoLink: boolean }> {
  return readDocument(store).workspaces ?? {};
}

/**
 * Clone records as state.json holds them, keyed by skill — no command writes
 * one yet.
 */
function recordClones(store: GrimoireStore, clonesBySkill: Record<string, CloneRecord[]>): void {
  const skills = Object.fromEntries(
    Object.entries(clonesBySkill).map(([skill, clones]) => [skill, { clones }]),
  );

  writeDocument(store, { skills });
}

/** The same records read back off disk, keyed by skill. */
function readClones(store: GrimoireStore): Record<string, CloneRecord[]> {
  const { skills = {} } = readDocument(store);

  return Object.fromEntries(Object.entries(skills).map(([skill, { clones }]) => [skill, clones]));
}

/** Merged into whatever state.json already holds, the way an edit by hand would be. */
function writeDocument(store: GrimoireStore, sections: StoredDocument): void {
  writeFileSync(store.paths.state, JSON.stringify({ ...readDocument(store), ...sections }), 'utf8');
}

function readDocument(store: GrimoireStore): StoredDocument {
  if (!existsSync(store.paths.state)) {
    return {};
  }

  return JSON.parse(readFileSync(store.paths.state, 'utf8')) as StoredDocument;
}

/**
 * A workspace registered at a path inside the store, which only a hand-edit can
 * produce — `workspaces add` refuses one.
 */
function registerColliding(store: GrimoireStore, name = 'personal'): string {
  const path = join(store.paths.skills, name);

  mkdirSync(path, { recursive: true });
  writeDocument(store, { workspaces: { [name]: { path, autoLink: false } } });

  return path;
}

/** What the `link` command will write, hand-built — it does not exist yet. */
function link(fixture: { store: GrimoireStore; workspacePath: string; skill: string }): void {
  const target = join(fixture.store.paths.skills, fixture.skill);

  mkdirSync(target, { recursive: true });
  symlinkSync(target, join(fixture.workspacePath, fixture.skill));
}
