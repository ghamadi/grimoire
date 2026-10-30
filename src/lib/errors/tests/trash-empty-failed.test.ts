import { describe, expect, it } from 'vitest';
import { GrimoireError, TrashEmptyFailedError } from '@/lib/errors';

const denied = { path: '/trash/triage', error: new Error('EACCES: permission denied') };
const alsoDenied = { path: '/trash/deploy', error: new Error('EPERM: not permitted') };

describe('TrashEmptyFailedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    expect(new TrashEmptyFailedError({ failures: [denied] })).toBeInstanceOf(GrimoireError);
  });

  it('reports a single failure as its bare sentence', () => {
    expect(new TrashEmptyFailedError({ failures: [denied] }).message).toBe(
      'failed to delete /trash/triage: EACCES: permission denied',
    );
  });

  it('aggregates several failures under a shared header, each indented', () => {
    expect(new TrashEmptyFailedError({ failures: [denied, alsoDenied] }).message).toBe(
      [
        'deletions failed:',
        '  failed to delete /trash/triage: EACCES: permission denied',
        '  failed to delete /trash/deploy: EPERM: not permitted',
      ].join('\n'),
    );
  });
});
