import { describe, expect, it } from 'vitest';
import { formatMissingArgument } from '@/lib/missing-argument';

describe('formatMissingArgument', () => {
  it('names the argument', () => {
    expect(formatMissingArgument({ name: 'skill' })).toBe("error: missing required argument 'skill'");
  });

  it('offers the --all-* flag', () => {
    expect(formatMissingArgument({ name: 'skills', allFlag: '--all-skills' })).toBe(
      "error: missing required argument 'skills' (or use --all-skills)",
    );
  });

  it('says the list flag took the names after it', () => {
    expect(
      formatMissingArgument({ name: 'skill', allFlag: '--all-skills', listFlag: '--to' }).split('\n'),
    ).toEqual([
      "error: missing required argument 'skill' (or use --all-skills)",
      '  --to takes every name after it, so name the skill before it',
    ]);
  });
});
