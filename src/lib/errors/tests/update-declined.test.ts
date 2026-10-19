import { describe, expect, it } from 'vitest';
import { GrimoireError, UpdateDeclinedError } from '@/lib/errors';

const props = { latestVersion: '0.2.0', packageName: '@ghamadi/grimoire' };

describe('UpdateDeclinedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    expect(new UpdateDeclinedError(props)).toBeInstanceOf(GrimoireError);
  });

  it('names the release and the commands that update other installs', () => {
    expect(new UpdateDeclinedError(props).message).toBe(
      [
        'grimoire 0.2.0 is available, but this copy was not installed with `npm install -g`',
        '  update it with the package manager that installed it:',
        '    pnpm add -g @ghamadi/grimoire@latest',
        '    yarn global add @ghamadi/grimoire@latest',
        '    bun add -g @ghamadi/grimoire@latest',
      ].join('\n'),
    );
  });

  it('carries the props it was constructed with', () => {
    const error = new UpdateDeclinedError(props);

    expect(error.latestVersion).toBe('0.2.0');
    expect(error.packageName).toBe('@ghamadi/grimoire');
  });
});
