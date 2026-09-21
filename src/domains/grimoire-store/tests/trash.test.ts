import { describe, expect, it } from 'vitest';
import { cloneTrashLabel, trashBinName } from '../helpers/trash.ts';

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

describe('cloneTrashLabel', () => {
  it('uses a workspace name verbatim', () => {
    expect(cloneTrashLabel({ workspace: 'personal' })).toBe('personal');
  });

  it('turns a path into one directory name', () => {
    expect(cloneTrashLabel({ path: '/Users/me/x' })).toBe('Users-me-x');
  });

  it('leaves no empty segment for a trailing separator', () => {
    expect(cloneTrashLabel({ path: '/Users/me/x/' })).toBe('Users-me-x');
  });

  it('leaves a slug of exactly 200 characters unchanged', () => {
    const path = `/${'a'.repeat(200)}`;

    expect(cloneTrashLabel({ path })).toBe('a'.repeat(200));
  });

  it('cuts a longer slug to 200 characters plus a hash of the path', () => {
    const label = cloneTrashLabel({ path: `/${'a'.repeat(201)}` });

    expect(label).toMatch(/^a{200}-[0-9a-f]{8}$/);
    expect(label).toHaveLength(209);
  });

  it('keeps two paths agreeing on their first 200 characters apart', () => {
    const shared = 'a'.repeat(200);

    expect(cloneTrashLabel({ path: `/${shared}/one` })).not.toBe(cloneTrashLabel({ path: `/${shared}/two` }));
  });
});
