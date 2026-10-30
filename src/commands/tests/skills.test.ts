import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { GrimoireStore } from '@/domains/grimoire-store';
import { SKILL_MANIFEST } from '@/domains/skill';
import {
  AddDeclinedError,
  EntityNotFoundError,
  GitCloneFailedError,
  GitUnavailableError,
  InvalidPathError,
  NoTerminalError,
  PackDeclinedError,
  PackFailedError,
  PathCollisionError,
  UnportableSkillError,
  WorkspaceUnreadableError,
} from '@/lib/errors';
import { buildProgram, type ProgramDependencies } from '@/program';
import { fakePicker } from '@test-helpers/fake-picker';
import { tempGitRepo } from '@test-helpers/git-repo';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';
import { readZipEntries, requireZipEntry } from '@test-helpers/zip-entries';

const credentials = 'user:s3cret';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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
    const { run } = await newCli({ picker: fakePicker({ choose: (labels) => labels }) });
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
      [`no terminal to choose skills from ${container}`, '  use --all to add every one'].join('\n'),
    );
    expect(existsSync(store.paths.skills)).toBe(false);
  });

  it('refuses without --all when there is no terminal, even over an empty container', async () => {
    const { run } = await newCli();
    const container = await newContainer();

    expect(await captureError(() => run('skills', 'add', container))).toBeInstanceOf(NoTerminalError);
  });

  it('refuses a path that does not exist as one when there is no terminal', async () => {
    const { run } = await newCli();
    const missing = join(await newDirectory('dev'), 'missing');

    expect(await captureError(() => run('skills', 'add', missing))).toBeInstanceOf(InvalidPathError);
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
    const picker = fakePicker({ choose: () => ['brainstorm'] });
    const { run, store } = await newCli({ picker });
    const container = await newContainer('brainstorm', 'deploy');

    const { stdout, stderr } = await run('skills', 'add', container);

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([]);
    expect(readdirSync(store.paths.skills)).toEqual(['brainstorm']);
  });

  it('offers the picker every source the crawl found, in crawl order', async () => {
    const picker = fakePicker({ choose: () => [] });
    const { run } = await newCli({ picker });
    const container = await newContainer('deploy', 'brainstorm');

    await run('skills', 'add', container);

    expect(picker.offered).toEqual(['brainstorm', 'deploy']);
  });

  it('reports in source order whatever order the picker returns', async () => {
    const picker = fakePicker({ choose: (labels) => [...labels].reverse() });
    const { run } = await newCli({ picker });
    const container = await newContainer('brainstorm', 'deploy');

    const { stdout } = await run('skills', 'add', container);

    expect(stdout).toEqual(['added brainstorm', 'added deploy']);
  });

  it('says so and touches nothing when the picker chooses nothing', async () => {
    const picker = fakePicker({ choose: () => [] });
    const { run, store } = await newCli({ picker });
    const container = await newContainer('brainstorm', 'deploy');

    const { stdout, stderr } = await run('skills', 'add', container);

    expect(stdout).toEqual(['nothing to add: no skill selected']);
    expect(stderr).toEqual([]);
    expect(existsSync(store.paths.skills)).toBe(false);
  });

  it('runs a picked source through the collision rules', async () => {
    const picker = fakePicker({ choose: (labels) => labels });
    const { run, store } = await newCli({ picker });
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
      `warning: could not link brainstorm → personal: ${join(personal, 'brainstorm')} holds a directory that differs from the store copy at "SKILL.md" — keep it with \`grimoire clone brainstorm --to personal\`, or delete it yourself`,
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
      `warning: could not link brainstorm → personal: ${cloned} is a clone — unclone it first with \`grimoire clone brainstorm --drop personal\``,
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

describe('skills add from a git URL', () => {
  const url = 'https://git.test/someone/skills.git';

  it.each([
    'https://git.test/someone/skills.git',
    'ssh://git.test/someone/skills.git',
    'git@git.test:someone/skills.git',
  ])('clones %s', async (source) => {
    const { run, store } = await newCli();
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) => writeSkillDirectory(join(repo, 'brainstorm')));
    const sandbox = await isolateTempDirectory();

    const { stdout, stderr } = await run('skills', 'add', source, '--all');

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([`cloning ${source}…`]);
    expect(readdirSync(store.paths.skills)).toEqual(['brainstorm']);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('reads an http:// argument as a path', async () => {
    const { run } = await newCli();
    const sandbox = await isolateTempDirectory();

    const error = await captureError(() =>
      run('skills', 'add', 'http://git.test/someone/skills.git', '--all'),
    );

    expect(error).toBeInstanceOf(InvalidPathError);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('prints the same lines as a local add of the same skills', async () => {
    const local = await newCli();
    const remote = await newCli();
    const container = await newContainer('brainstorm', 'deploy');
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) => {
      writeSkillDirectory(join(repo, 'brainstorm'));
      writeSkillDirectory(join(repo, 'tools', 'deploy'));
    });
    const localOutput = await local.run('skills', 'add', container, '--all');
    const sandbox = await isolateTempDirectory();

    const { stdout, stderr } = await remote.run('skills', 'add', url, '--all');

    expect(stdout).toEqual(['added brainstorm', 'added deploy']);
    expect(stdout).toEqual(localOutput.stdout);
    expect(stderr).toEqual([`cloning ${url}…`]);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('offers the picker each source by its path inside the repo', async () => {
    const picker = fakePicker({ choose: () => [] });
    const { run } = await newCli({ picker });
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) => {
      writeSkillDirectory(join(repo, 'brainstorm'));
      writeSkillDirectory(join(repo, 'tools', 'deploy'));
    });
    const sandbox = await isolateTempDirectory();

    await run('skills', 'add', url);

    expect(picker.offeredHints).toEqual(['brainstorm', join('tools', 'deploy')]);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('stores a repo that is itself a skill under the repo name, without its .git', async () => {
    const { run, store } = await newCli();
    const { publishRepo } = await newGitHost();
    const triageUrl = 'https://git.test/someone/triage.git';
    await publishRepo('someone/triage.git', (repo) => writeSkillDirectory(repo));
    const sandbox = await isolateTempDirectory();

    const first = await run('skills', 'add', triageUrl, '--all');

    expect(first.stdout).toEqual(['added triage']);
    expect(existsSync(join(store.paths.skills, 'triage', SKILL_MANIFEST))).toBe(true);
    expect(existsSync(join(store.paths.skills, 'triage', '.git'))).toBe(false);
    expect(readdirSync(sandbox)).toEqual([]);

    const second = await run('skills', 'add', triageUrl, '--all');

    expect(second.stdout).toEqual(['already in the store: triage']);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('names an unportable nested skill by its path inside the repo', async () => {
    const { run } = await newCli();
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) => {
      writeSkillDirectory(join(repo, 'brainstorm'));
      writeSkillDirectory(join(repo, 'tools', 'scratch'));
      writeSkillDirectory(join(repo, 'tools', 'scratch', 'sub'));
    });
    const sandbox = await isolateTempDirectory();

    const { stdout, stderr } = await run('skills', 'add', url, '--all');

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([
      `cloning ${url}…`,
      `warning: could not add scratch: skill "${join('tools', 'scratch')}" is not portable. Contains a nested skill.`,
    ]);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('names an unportable repo that is itself a skill by the URL', async () => {
    const { run } = await newCli();
    const { publishRepo } = await newGitHost();
    const triageUrl = 'https://git.test/someone/triage.git';
    await publishRepo('someone/triage.git', (repo) => {
      writeSkillDirectory(repo);
      writeSkillDirectory(join(repo, 'sub'));
    });
    const sandbox = await isolateTempDirectory();

    const error = await captureError(() => run('skills', 'add', triageUrl, '--all'));

    expect(error).toBeInstanceOf(AddDeclinedError);
    expect(error.message).toBe(
      `could not add triage: skill "${triageUrl}" is not portable. Contains a nested skill.`,
    );
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('names a source holding a symlink by its path inside the repo', async () => {
    const { run, store } = await newCli();
    const { publishRepo } = await newGitHost();
    storeSkill(store, 'deploy');
    await publishRepo('someone/skills.git', (repo) => {
      writeSkillDirectory(join(repo, 'brainstorm'));
      writeSkillDirectory(join(repo, 'tools', 'deploy'));
      symlinkSync(SKILL_MANIFEST, join(repo, 'tools', 'deploy', 'link.md'));
    });
    const sandbox = await isolateTempDirectory();

    const { stdout, stderr } = await run('skills', 'add', url, '--all');

    expect(stdout).toEqual(['added brainstorm']);
    expect(stderr).toEqual([
      `cloning ${url}…`,
      `warning: could not add deploy: ${join('tools', 'deploy')} holds the symlink "link.md", so the two copies cannot be compared`,
    ]);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('says so and touches nothing when the picker chooses nothing', async () => {
    const picker = fakePicker({ choose: () => [] });
    const { run, store } = await newCli({ picker });
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) => writeSkillDirectory(join(repo, 'brainstorm')));
    const sandbox = await isolateTempDirectory();

    const { stdout } = await run('skills', 'add', url);

    expect(stdout).toEqual(['nothing to add: no skill selected']);
    expect(existsSync(store.paths.skills)).toBe(false);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('names the URL when the repo holds no skills', async () => {
    const { run } = await newCli({ picker: fakePicker({ choose: (labels) => labels }) });
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) =>
      writeFileSync(join(repo, 'README.md'), '# skills', 'utf8'),
    );
    const sandbox = await isolateTempDirectory();

    const { stdout } = await run('skills', 'add', url);

    expect(stdout).toEqual([`nothing to add: no skill found under ${url}`]);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('names the URL and clones nothing when there is no terminal to choose from', async () => {
    const { runFailing } = await newCli();
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) => writeSkillDirectory(join(repo, 'brainstorm')));
    const sandbox = await isolateTempDirectory();

    const { stderr, error } = await runFailing('skills', 'add', url);

    expect(error).toBeInstanceOf(NoTerminalError);
    expect(error.message).toBe(
      [`no terminal to choose skills from ${url}`, '  use --all to add every one'].join('\n'),
    );
    expect(stderr.some((line) => line.startsWith('cloning'))).toBe(false);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('escapes as AddDeclinedError when every source is declined, leaving the store copy alone', async () => {
    const { run, store } = await newCli();
    const { publishRepo } = await newGitHost();
    storeSkill(store, 'deploy');
    await publishRepo('someone/skills.git', (repo) =>
      writeSkillDirectory(join(repo, 'deploy'), { [SKILL_MANIFEST]: 'edited' }),
    );
    const sandbox = await isolateTempDirectory();

    const error = await captureError(() => run('skills', 'add', url, '--all'));

    expect(error).toBeInstanceOf(AddDeclinedError);
    expect(readFileSync(join(store.paths.skills, 'deploy', SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('throws GitCloneFailedError and creates no store when the clone fails', async () => {
    const { runFailing, store } = await newCli();
    await newGitHost();
    const missingUrl = 'https://git.test/someone/missing.git';
    const sandbox = await isolateTempDirectory();

    const { stderr, error } = await runFailing('skills', 'add', missingUrl, '--all');

    expect(error).toBeInstanceOf(GitCloneFailedError);
    expect(error.message.startsWith(`could not clone ${missingUrl}:\n`)).toBe(true);
    expect(stderr).toEqual([`cloning ${missingUrl}…`]);
    expect(existsSync(store.paths.skills)).toBe(false);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  describe('a URL carrying credentials', () => {
    it('leaves them out of the cloning line and the messages naming the URL', async () => {
      const { run } = await newCli({ picker: fakePicker({ choose: (labels) => labels }) });
      const { publishRepo } = await newGitHost();
      await publishRepo('someone/skills.git', (repo) =>
        writeFileSync(join(repo, 'README.md'), '# skills', 'utf8'),
      );

      const { stdout, stderr } = await run(
        'skills',
        'add',
        `https://${credentials}@git.test/someone/skills.git`,
      );

      expect(stdout).toEqual([`nothing to add: no skill found under ${url}`]);
      expect(stderr).toEqual([`cloning ${url}…`]);
    });

    it('leaves them out of the name of a repo that is itself a skill', async () => {
      const { run } = await newCli();
      const { publishRepo } = await newGitHost();
      await publishRepo('someone/triage.git', (repo) => {
        writeSkillDirectory(repo);
        writeSkillDirectory(join(repo, 'sub'));
      });

      const error = await captureError(() =>
        run('skills', 'add', `https://${credentials}@git.test/someone/triage.git`, '--all'),
      );

      expect(error.message).toBe(
        'could not add triage: skill "https://git.test/someone/triage.git" is not portable. Contains a nested skill.',
      );
    });

    it('leaves them out of a failed clone', async () => {
      const { runFailing } = await newCli();
      await newGitHost();

      const { stderr, error } = await runFailing(
        'skills',
        'add',
        `https://${credentials}@git.test/someone/missing.git`,
        '--all',
      );

      expect(error).toBeInstanceOf(GitCloneFailedError);
      expect(error.message.startsWith('could not clone https://git.test/someone/missing.git:\n')).toBe(
        true,
      );
      expect(error.message).not.toContain('s3cret');
      expect(stderr).toEqual(['cloning https://git.test/someone/missing.git…']);
    });
  });

  it('throws GitUnavailableError for a URL with git missing from PATH', async () => {
    const { run } = await newCli();
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) => writeSkillDirectory(join(repo, 'brainstorm')));
    const sandbox = await isolateTempDirectory();
    vi.stubEnv('PATH', '');

    const error = await captureError(() => run('skills', 'add', url, '--all'));

    expect(error).toBeInstanceOf(GitUnavailableError);
    expect(readdirSync(sandbox)).toEqual([]);
  });

  it('still adds from a local path with git missing from PATH', async () => {
    const { run } = await newCli();
    const container = await newContainer('brainstorm');
    vi.stubEnv('PATH', '');

    const { stdout } = await run('skills', 'add', container, '--all');

    expect(stdout).toEqual(['added brainstorm']);
  });

  it('links a URL-added skill into an auto-link workspace', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const { publishRepo } = await newGitHost();
    await publishRepo('someone/skills.git', (repo) => writeSkillDirectory(join(repo, 'brainstorm')));
    await registerAutoLink(run, 'personal', personal);
    const sandbox = await isolateTempDirectory();

    const { stdout } = await run('skills', 'add', url, '--all');

    expect(stdout).toEqual(['added brainstorm', 'linked brainstorm → personal']);
    expect(readlinkSync(join(personal, 'brainstorm'))).toBe(join(store.paths.skills, 'brainstorm'));
    expect(readdirSync(sandbox)).toEqual([]);
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

describe('skills pack', () => {
  describe('what it writes', () => {
    it('prints each skill in argument order, and each zip holds an exact copy under one folder', async () => {
      const { run, store } = await newCli();
      const out = await newDirectory('dist');

      storeSkill(store, 'triage');
      mkdirSync(join(store.paths.skills, 'review', 'refs'), { recursive: true });
      writeSkillDirectory(join(store.paths.skills, 'review'), { 'refs/guide.md': 'guide' });

      const { stdout, stderr } = await run('skills', 'pack', 'triage', 'review', '--out', out);

      expect(stdout).toEqual([
        `packed triage → ${join(out, 'triage.zip')}`,
        `packed review → ${join(out, 'review.zip')}`,
      ]);
      expect(stderr).toEqual([]);

      const entries = readZipEntries({ path: join(out, 'review.zip') });

      expect(entries.map(({ name }) => name)).toEqual([
        'review/',
        `review/${SKILL_MANIFEST}`,
        'review/refs/',
        'review/refs/guide.md',
      ]);
      expect(
        Buffer.from(requireZipEntry({ entries, name: 'review/refs/guide.md' }).data).toString(),
      ).toBe('guide');
    });

    it('counts a repeated name once', async () => {
      const { run, store } = await newCli();
      const out = await newDirectory('dist');

      storeSkill(store, 'triage');

      const { stdout } = await run('skills', 'pack', 'triage', 'triage', '--out', out);

      expect(stdout).toEqual([`packed triage → ${join(out, 'triage.zip')}`]);
    });

    it('packs every skill in name order with --all', async () => {
      const { run, store } = await newCli();
      const out = await newDirectory('dist');

      storeSkill(store, 'triage');
      storeSkill(store, 'brainstorm');

      const { stdout } = await run('skills', 'pack', '--all', '--out', out);

      expect(stdout).toEqual([
        `packed brainstorm → ${join(out, 'brainstorm.zip')}`,
        `packed triage → ${join(out, 'triage.zip')}`,
      ]);
    });

    it('writes to the current folder by default', async () => {
      const { run, store } = await newCli();
      const directory = await newDirectory('here');
      const previousDirectory = process.cwd();

      storeSkill(store, 'triage');
      process.chdir(directory);
      onTestFinished(() => {
        process.chdir(previousDirectory);
      });

      const { stdout } = await run('skills', 'pack', 'triage');

      expect(stdout).toEqual([`packed triage → ${join(realpathSync(directory), 'triage.zip')}`]);
      expect(existsSync(join(directory, 'triage.zip'))).toBe(true);
    });

    it('adds nothing to the store and leaves no staging folder', async () => {
      const { run, store } = await newCli();
      const out = await newDirectory('dist');

      storeSkill(store, 'triage');

      await run('skills', 'pack', 'triage', '--out', out);

      expect(readdirSync(store.paths.skills)).toEqual(['triage']);
      expect(readdirSync(out)).toEqual(['triage.zip']);
    });

    it('still runs when state.json is broken', async () => {
      const { run, store } = await newCli();
      const out = await newDirectory('dist');

      storeSkill(store, 'triage');
      writeFileSync(store.paths.state, '{ not json', 'utf8');

      const { stdout } = await run('skills', 'pack', 'triage', '--out', out);

      expect(stdout).toEqual([`packed triage → ${join(out, 'triage.zip')}`]);
    });

    it('accepts the folder containing the store as --out', async () => {
      const { run, store } = await newCli();
      const out = dirname(store.paths.root);
      const skill = 'pack-beside-the-store';
      const zipPath = join(out, `${skill}.zip`);

      storeSkill(store, skill);
      onTestFinished(() => {
        rmSync(zipPath, { force: true });
      });

      const { stdout } = await run('skills', 'pack', skill, '--out', out);

      expect(stdout).toEqual([`packed ${skill} → ${zipPath}`]);
    });
  });

  describe('an empty store', () => {
    it('prints a message and exits clean under --all, even with a missing --out', async () => {
      const { run } = await newCli();
      const out = join(await newDirectory('dist'), 'gone');

      const { stdout, stderr } = await run('skills', 'pack', '--all', '--out', out);

      expect(stdout).toEqual(['nothing to pack: the store holds no skills']);
      expect(stderr).toEqual([]);
    });
  });

  describe('refusals', () => {
    it('refuses named skills with --all', async () => {
      const { runFailing } = await newCli();

      const { error } = await runFailing('skills', 'pack', 'triage', '--all');

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message).toBe('error: --all cannot be combined with named skills');
    });

    it('refuses a run with no skill and no --all', async () => {
      const { runFailing } = await newCli();

      const { error } = await runFailing('skills', 'pack');

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message).toBe("error: missing required argument 'skills' (or use --all)");
    });

    it('refuses an unknown skill', async () => {
      const { runFailing } = await newCli();
      const out = await newDirectory('dist');

      const { error } = await runFailing('skills', 'pack', 'nope', '--out', out);

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe('no skill named "nope"');
    });

    it('refuses a store entry with no SKILL.md as unknown', async () => {
      const { runFailing, store } = await newCli();
      const out = await newDirectory('dist');

      mkdirSync(join(store.paths.skills, 'draft'), { recursive: true });

      const { error } = await runFailing('skills', 'pack', 'draft', '--out', out);

      expect(error).toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses an unportable skill, writing nothing for the others', async () => {
      const { runFailing, store } = await newCli();
      const out = await newDirectory('dist');

      storeSkill(store, 'triage');
      mkdirSync(join(store.paths.skills, 'nested', 'sub'), { recursive: true });
      writeSkillDirectory(join(store.paths.skills, 'nested'), { [`sub/${SKILL_MANIFEST}`]: 'x' });

      const { error } = await runFailing('skills', 'pack', 'triage', 'nested', '--out', out);

      expect(error).toBeInstanceOf(UnportableSkillError);
      expect(readdirSync(out)).toEqual([]);
    });

    it('reports an unknown skill named after an unportable one as unknown', async () => {
      const { runFailing, store } = await newCli();
      const out = await newDirectory('dist');

      mkdirSync(join(store.paths.skills, 'nested', 'sub'), { recursive: true });
      writeSkillDirectory(join(store.paths.skills, 'nested'), { [`sub/${SKILL_MANIFEST}`]: 'x' });

      const { error } = await runFailing('skills', 'pack', 'nested', 'nope', '--out', out);

      expect(error).toBeInstanceOf(EntityNotFoundError);
    });

    it('reports a bad skill ahead of a bad --out', async () => {
      const { runFailing } = await newCli();
      const out = join(await newDirectory('dist'), 'gone');

      const { error } = await runFailing('skills', 'pack', 'nope', '--out', out);

      expect(error).toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses a missing --out and a --out that is a file', async () => {
      const { runFailing, store } = await newCli();
      const directory = await newDirectory('dist');
      const file = join(directory, 'file');

      storeSkill(store, 'triage');
      writeFileSync(file, '', 'utf8');

      const missing = await runFailing('skills', 'pack', 'triage', '--out', join(directory, 'gone'));
      const notDirectory = await runFailing('skills', 'pack', 'triage', '--out', file);

      expect(missing.error).toBeInstanceOf(InvalidPathError);
      expect(notDirectory.error).toBeInstanceOf(InvalidPathError);
    });

    it('refuses the store and a folder inside it, including through a symlink', async () => {
      const { runFailing, store } = await newCli();
      const link = join(await newDirectory('dev'), 'link');

      storeSkill(store, 'triage');
      symlinkSync(join(store.paths.skills, 'triage'), link);

      for (const out of [store.paths.root, store.paths.skills, link]) {
        const { error } = await runFailing('skills', 'pack', 'triage', '--out', out);

        expect(error).toBeInstanceOf(PathCollisionError);
      }

      expect(readdirSync(store.paths.skills)).toEqual(['triage']);
    });
  });

  describe('declines', () => {
    it('declines a skill holding a symlink, naming it, as a warning beside a packed skill', async () => {
      const { run, store } = await newCli();
      const out = await newDirectory('dist');
      const linked = storeSkill(store, 'linked');

      storeSkill(store, 'triage');
      mkdirSync(join(linked, 'refs'));
      symlinkSync(join(linked, SKILL_MANIFEST), join(linked, 'refs', 'alias.md'));

      const { stdout, stderr } = await run('skills', 'pack', 'linked', 'triage', '--out', out);

      expect(stdout).toEqual([`packed triage → ${join(out, 'triage.zip')}`]);
      expect(stderr).toEqual([
        `warning: could not pack linked → ${join(out, 'linked.zip')}: the skill holds the symlink "refs/alias.md"`,
      ]);
      expect(readdirSync(out)).toEqual(['triage.zip']);
    });

    it.each([
      ['a file', (path: string) => writeFileSync(path, 'mine', 'utf8')],
      ['a folder', (path: string) => mkdirSync(path)],
      ['a dangling symlink', (path: string) => symlinkSync(join(path, 'gone'), path)],
    ])('declines when the zip path holds %s, as one error line', async (_, occupy) => {
      const { runFailing, store } = await newCli();
      const out = await newDirectory('dist');
      const zipPath = join(out, 'triage.zip');

      storeSkill(store, 'triage');
      occupy(zipPath);

      const { stdout, stderr, error } = await runFailing('skills', 'pack', 'triage', '--out', out);

      expect(error).toBeInstanceOf(PackDeclinedError);
      expect(error.message).toBe(
        `could not pack triage → ${zipPath}: something is already there — delete it to pack again`,
      );
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([]);
    });

    it('prints several declines under one header, when every skill declined', async () => {
      const { runFailing, store } = await newCli();
      const out = await newDirectory('dist');

      storeSkill(store, 'review');
      storeSkill(store, 'triage');
      writeFileSync(join(out, 'review.zip'), 'mine', 'utf8');
      writeFileSync(join(out, 'triage.zip'), 'mine', 'utf8');

      const { stdout, error } = await runFailing('skills', 'pack', '--all', '--out', out);

      expect(error).toBeInstanceOf(PackDeclinedError);
      expect(error.message).toBe(
        [
          'nothing packed:',
          `  could not pack review → ${join(out, 'review.zip')}: something is already there — delete it to pack again`,
          `  could not pack triage → ${join(out, 'triage.zip')}: something is already there — delete it to pack again`,
        ].join('\n'),
      );
      expect(stdout).toEqual([]);
    });
  });

  describe('failures', () => {
    it('fails every skill when the staging path is a file', async () => {
      const { runFailing, store } = await newCli();
      const out = await newDirectory('dist');

      storeSkill(store, 'triage');
      writeFileSync(join(out, '.grimoire-staging'), '', 'utf8');

      const { error } = await runFailing('skills', 'pack', 'triage', '--out', out);

      expect(error).toBeInstanceOf(PackFailedError);
      expect(existsSync(join(out, 'triage.zip'))).toBe(false);
    });

    describe.skipIf(runsAsRoot)('permissions', () => {
      it('fails on a read-only --out', async () => {
        const { runFailing, store } = await newCli();
        const out = await newDirectory('dist');

        storeSkill(store, 'triage');
        lockDirectory({ path: out, mode: 0o555 });

        const { stdout, error } = await runFailing('skills', 'pack', 'triage', '--out', out);

        expect(error).toBeInstanceOf(PackFailedError);
        expect(error.message).toContain(`failed to pack triage → ${join(out, 'triage.zip')}: EACCES`);
        expect(stdout).toEqual([]);
      });

      it('fails only the skill with an unreadable file, keeping packed lines and warnings, failure last', async () => {
        const { runFailing, store } = await newCli();
        const out = await newDirectory('dist');
        const secret = join(storeSkill(store, 'secret'), 'private.md');
        const linked = storeSkill(store, 'linked');

        storeSkill(store, 'triage');
        symlinkSync(join(linked, SKILL_MANIFEST), join(linked, 'alias.md'));
        writeFileSync(secret, 'x', 'utf8');
        chmodSync(secret, 0o000);

        const { stdout, stderr, error } = await runFailing('skills', 'pack', '--all', '--out', out);

        expect(stdout).toEqual([`packed triage → ${join(out, 'triage.zip')}`]);
        expect(stderr).toEqual([
          `warning: could not pack linked → ${join(out, 'linked.zip')}: the skill holds the symlink "alias.md"`,
        ]);
        expect(error).toBeInstanceOf(PackFailedError);
        expect(error.message).toContain(`failed to pack secret → ${join(out, 'secret.zip')}: EACCES`);
        expect(readdirSync(out)).toEqual(['triage.zip']);
      });
    });
  });
});

describe('skills path', () => {
  it("prints a skill's store directory, alone", async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');

    const { stdout, stderr } = await run('skills', 'path', 'triage');

    expect(stdout).toEqual([join(store.paths.skills, 'triage')]);
    expect(stderr).toEqual([]);
  });

  it("prints the store's skills directory before the store exists, creating nothing", async () => {
    const { run, store } = await newCli();

    expect((await run('skills', 'path')).stdout).toEqual([store.paths.skills]);
    expect(existsSync(store.paths.skills)).toBe(false);
  });

  it('refuses a skill the store does not hold, printing nothing', async () => {
    const { runFailing } = await newCli();

    const { stdout, error } = await runFailing('skills', 'path', 'nope');

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no skill named "nope"');
    expect(stdout).toEqual([]);
  });

  it('refuses a loose file and a directory with no SKILL.md', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'brainstorm');
    writeFileSync(join(store.paths.skills, 'notes.md'), 'not a skill', 'utf8');
    mkdirSync(join(store.paths.skills, 'draft'));

    expect(await captureError(() => run('skills', 'path', 'notes.md'))).toBeInstanceOf(
      EntityNotFoundError,
    );
    expect(await captureError(() => run('skills', 'path', 'draft'))).toBeInstanceOf(EntityNotFoundError);
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

  it('refuses a name that resolves outside the store, moving nothing', async () => {
    const { run, store } = await newCli();
    const outside = await newDirectory('outside');
    const name = relative(store.paths.skills, outside);

    const error = await captureError(() => run('skills', 'remove', name));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(existsSync(outside)).toBe(true);
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

  async function capture(argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let thrown: unknown;

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      await program.parseAsync(argv, { from: 'user' });
    } catch (caught) {
      thrown = caught;
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }

    return { stdout, stderr, thrown };
  }

  async function run(...argv: string[]) {
    const { stdout, stderr, thrown } = await capture(argv);

    if (thrown !== undefined) {
      throw thrown as Error;
    }

    return { stdout, stderr };
  }

  async function runFailing(...argv: string[]) {
    const { stdout, stderr, thrown } = await capture(argv);

    if (thrown === undefined) {
      throw new Error('expected a refusal');
    }

    return { stdout, stderr, error: thrown as Error };
  }

  return { run, runFailing, store };
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

/** `file://` rather than a plain path, because git ignores `--depth` for a path. */
async function newGitHost() {
  const reposRoot = await tempRoot();
  const prefixes = [
    'https://git.test/',
    `https://${credentials}@git.test/`,
    'ssh://git.test/',
    'git@git.test:',
  ];

  vi.stubEnv('GIT_CONFIG_COUNT', String(prefixes.length));
  prefixes.forEach((prefix, index) => {
    vi.stubEnv(`GIT_CONFIG_KEY_${index}`, `url.file://${reposRoot}/.insteadOf`);
    vi.stubEnv(`GIT_CONFIG_VALUE_${index}`, prefix);
  });

  async function publishRepo(name: string, writeSkills: (repo: string) => void): Promise<void> {
    const { path: repo, commitAll } = await tempGitRepo({ path: join(reposRoot, name) });
    writeSkills(repo);
    commitAll();
  }

  return { publishRepo };
}

/** Called after every other `tempRoot()`, which would otherwise land in the sandbox too. */
async function isolateTempDirectory(): Promise<string> {
  const sandbox = await tempRoot();
  vi.stubEnv('TMPDIR', sandbox);

  return sandbox;
}

/** A directory holding one default skill directory per name, outside the store root. */
async function newContainer(...skillNames: string[]): Promise<string> {
  const path = await newDirectory('skills');

  for (const name of skillNames) {
    writeSkillDirectory(join(path, name));
  }

  return path;
}
