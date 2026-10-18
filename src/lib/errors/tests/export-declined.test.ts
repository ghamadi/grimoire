import { describe, expect, it } from 'vitest';
import { ExportDeclinedError, GrimoireError, describeExportRefusal } from '@/lib/errors';
import type { ExportRefusal } from '@/lib/errors';

const FORCE_LINE = '  commit first, or use --force to overwrite them';

const triage: ExportRefusal = {
  skill: 'triage',
  repo: 'library',
  path: '/Users/me/library/triage',
};

const review: ExportRefusal = {
  skill: 'review',
  repo: 'library',
  path: '/Users/me/library/review',
};

describe('describeExportRefusal', () => {
  it('describes a destination with uncommitted changes', () => {
    expect(describeExportRefusal(triage)).toBe(
      'could not export triage → library: /Users/me/library/triage has uncommitted changes',
    );
  });

  it('never names --force', () => {
    expect(describeExportRefusal(triage)).not.toContain('--force');
  });
});

describe('ExportDeclinedError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new ExportDeclinedError({ refusals: [triage] });

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.name).toBe('ExportDeclinedError');
  });

  it('reports a single refusal as its bare sentence, then the --force line', () => {
    const error = new ExportDeclinedError({ refusals: [triage] });

    expect(error.message).toBe([describeExportRefusal(triage), FORCE_LINE].join('\n'));
  });

  it('aggregates several refusals under a shared header, each indented, with the --force line last', () => {
    const error = new ExportDeclinedError({ refusals: [triage, review] });

    expect(error.message).toBe(
      [
        'nothing exported:',
        `  ${describeExportRefusal(triage)}`,
        `  ${describeExportRefusal(review)}`,
        FORCE_LINE,
      ].join('\n'),
    );
  });

  it('carries the refusals it was constructed with', () => {
    const refusals = [triage, review];
    const error = new ExportDeclinedError({ refusals });

    expect(error.refusals).toBe(refusals);
  });
});
