import { describe, expect, it } from 'vitest';
import { GitCloneFailedError, GrimoireError } from '@/lib/errors';

const url = 'https://github.com/someone/skills.git';

describe('GitCloneFailedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    expect(new GitCloneFailedError({ url, reason: '' })).toBeInstanceOf(GrimoireError);
  });

  it('names the URL, then indents each line of the reason', () => {
    const error = new GitCloneFailedError({
      url,
      reason:
        "remote: Repository not found.\nfatal: repository 'https://github.com/someone/skills.git/' not found\n",
    });

    expect(error.message).toBe(
      [
        'could not clone https://github.com/someone/skills.git:',
        '  remote: Repository not found.',
        "  fatal: repository 'https://github.com/someone/skills.git/' not found",
      ].join('\n'),
    );
  });

  it('drops blank lines from the reason', () => {
    const error = new GitCloneFailedError({
      url: 'git@github.com:someone/skills.git',
      reason:
        'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n',
    });

    expect(error.message).toBe(
      [
        'could not clone git@github.com:someone/skills.git:',
        '  git@github.com: Permission denied (publickey).',
        '  fatal: Could not read from remote repository.',
        '  Please make sure you have the correct access rights',
        '  and the repository exists.',
      ].join('\n'),
    );
  });

  it('carries the url and reason it was constructed with', () => {
    const error = new GitCloneFailedError({ url, reason: 'git was stopped by SIGINT' });

    expect(error.url).toBe(url);
    expect(error.reason).toBe('git was stopped by SIGINT');
  });
});
