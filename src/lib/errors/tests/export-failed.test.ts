import { describe, expect, it } from 'vitest';
import { ExportFailedError, GrimoireError, describeExportFailure } from '@/lib/errors/index';
import type { ExportFailure } from '@/lib/errors/index';

const denied: ExportFailure = {
  skill: 'triage',
  repo: 'library',
  path: '/Users/me/library/triage',
  error: new Error("EACCES: permission denied, rename '/a' -> '/b'"),
};

const unusableStaging: ExportFailure = {
  skill: 'review',
  repo: 'library',
  path: '/Users/me/library/review',
  error: new Error('/Users/me/library/.grimoire-staging is not a directory'),
};

describe('describeExportFailure', () => {
  it('describes a failed skill by its error message', () => {
    expect(describeExportFailure(denied)).toBe(
      "failed to export triage → library: EACCES: permission denied, rename '/a' -> '/b'",
    );
  });
});

describe('ExportFailedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new ExportFailedError({ failures: [denied] });

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.name).toBe('ExportFailedError');
  });

  it('reports a single failure as its bare sentence', () => {
    const error = new ExportFailedError({ failures: [denied] });

    expect(error.message).toBe(describeExportFailure(denied));
  });

  it('aggregates several failures under a shared header, each indented', () => {
    const error = new ExportFailedError({ failures: [unusableStaging, denied] });

    expect(error.message).toBe(
      [
        'exports failed:',
        `  ${describeExportFailure(unusableStaging)}`,
        `  ${describeExportFailure(denied)}`,
      ].join('\n'),
    );
  });

  it('carries the failures it was constructed with', () => {
    const failures = [denied, unusableStaging];
    const error = new ExportFailedError({ failures });

    expect(error.failures).toBe(failures);
  });
});
