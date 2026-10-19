import { describe, expect, it } from 'vitest';
import { GrimoireError, NpmFailedError } from '@/lib/errors';

const args = ['install', '-g', '@ghamadi/grimoire@0.2.0'];

describe('NpmFailedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    expect(new NpmFailedError({ args, stderr: '' })).toBeInstanceOf(GrimoireError);
  });

  it('names the npm command, then indents each line of npm output', () => {
    const error = new NpmFailedError({
      args,
      stderr: 'npm error code EACCES\nnpm error syscall mkdir\n',
    });

    expect(error.message).toBe(
      [
        "`npm install -g '@ghamadi/grimoire@0.2.0'` failed:",
        '  npm error code EACCES',
        '  npm error syscall mkdir',
      ].join('\n'),
    );
  });

  it('drops blank lines from npm output', () => {
    const error = new NpmFailedError({
      args: ['view', '@ghamadi/grimoire', 'version'],
      stderr: '\nnpm error code ENOTFOUND\n\n   \nnpm error network request failed\n\n',
    });

    expect(error.message).toBe(
      [
        "`npm view '@ghamadi/grimoire' version` failed:",
        '  npm error code ENOTFOUND',
        '  npm error network request failed',
      ].join('\n'),
    );
  });

  it('is just the header when npm printed nothing', () => {
    const error = new NpmFailedError({ args: ['root', '-g'], stderr: '' });

    expect(error.message).toBe('`npm root -g` failed:');
  });

  it('carries the args and stderr it was constructed with', () => {
    const error = new NpmFailedError({ args, stderr: 'npm error code EACCES\n' });

    expect(error.args).toBe(args);
    expect(error.stderr).toBe('npm error code EACCES\n');
  });
});
