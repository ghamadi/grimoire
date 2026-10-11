import { describe, expect, it } from 'vitest';
import { trashBinName } from '@/domains/grimoire-store/helpers/trash';

describe('trashBinName', () => {
  it('stamps the skill with its local date and time', () => {
    expect(trashBinName({ skill: 'triage', at: new Date(2026, 8, 15, 12, 45, 30) })).toBe(
      'triage-20260915T124530',
    );
  });

  it('pads single-digit parts', () => {
    expect(trashBinName({ skill: 'triage', at: new Date(2026, 0, 2, 3, 4, 5) })).toBe(
      'triage-20260102T030405',
    );
  });

  // toISOString() answers in UTC, so this fails on any machine not running in it.
  it('reads the local clock rather than UTC', () => {
    const at = new Date(2026, 8, 15, 23, 59, 59);

    expect(trashBinName({ skill: 'triage', at })).toBe('triage-20260915T235959');
  });
});
