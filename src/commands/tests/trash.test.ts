import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextStyler } from '@/lib/text-styler';
import { GrimoireStore } from '@/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '@/domains/skill/index';
import { buildProgram, type ProgramDependencies } from '@/program';
import { tempRoot } from '@test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trash empty', () => {
  it('prints one line per bin in name order, then the count', async () => {
    const { run, store } = await newCli();
    const triagePath = writeBin(store, 'triage-20260915T124530');
    const deployPath = writeBin(store, 'deploy-20260920T091502');

    const { stdout, stderr } = run('trash', 'empty');

    expect(stdout).toEqual([
      `deleted ${deployPath}`,
      `deleted ${triagePath}`,
      'emptied the trash: 2 bins',
    ]);
    expect(stderr).toEqual([]);
    expect(readdirSync(store.paths.trash)).toEqual([]);
  });

  it('counts a single bin in the singular', async () => {
    const { run, store } = await newCli();

    writeBin(store, 'triage-20260915T124530');

    const { stdout } = run('trash', 'empty');

    expect(stdout.at(-1)).toBe('emptied the trash: 1 bin');
  });

  it('says the trash is empty', async () => {
    const { run } = await newCli();

    const { stdout } = run('trash', 'empty');

    expect(stdout).toEqual(['nothing to delete: the trash is empty']);
  });

  describe('colors', () => {
    const taggingTextStyler: TextStyler = (style, text) => `<${style}>${text}</${style}>`;

    it('colors the verb red and the count bold, and leaves the path plain', async () => {
      const { run, store } = await newCli({ textStyler: taggingTextStyler });
      const triagePath = writeBin(store, 'triage-20260915T124530');

      const { stdout } = run('trash', 'empty');

      expect(stdout).toEqual([
        `<red>deleted</red> ${triagePath}`,
        '<bold>emptied the trash: 1 bin</bold>',
      ]);
    });

    it('dims the empty-trash line', async () => {
      const { run } = await newCli({ textStyler: taggingTextStyler });

      const { stdout } = run('trash', 'empty');

      expect(stdout).toEqual(['<dim>nothing to delete: the trash is empty</dim>']);
    });
  });

  describe('refusals', () => {
    it('refuses an argument instead of emptying everything', async () => {
      const { run, store } = await newCli();
      const triagePath = writeBin(store, 'triage-20260915T124530');

      const error = captureError(() => run('trash', 'empty', 'triage'));

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message).toBe(
        "error: too many arguments for 'empty'. Expected 0 arguments but got 1: triage.",
      );
      expect(existsSync(triagePath)).toBe(true);
    });
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

/** The error a refusal threw, so its exact message can be asserted on. */
function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}

/** A bin under `.trash/` holding a trashed skill, and its path. */
function writeBin(store: GrimoireStore, binName: string): string {
  const binPath = join(store.paths.trash, binName);

  mkdirSync(join(binPath, 'store'), { recursive: true });
  writeFileSync(join(binPath, 'store', SKILL_MANIFEST), '# skill\n', 'utf8');

  return binPath;
}
