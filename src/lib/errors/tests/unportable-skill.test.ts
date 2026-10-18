import { describe, expect, it } from 'vitest';
import { UnportableSkillError } from '@/lib/errors';
import type { UnportableSkillReason } from '@/lib/errors';
import { describeUnportableSkill } from '@/lib/errors/unportable-skill';

const reasons: [UnportableSkillReason, string][] = [
  ['nested-skill', 'Contains a nested skill.'],
  ['not-a-skill', 'Is not a skill directory.'],
  ['unexpected-file-type', 'An unexpected file type was encountered.'],
];

describe('describeUnportableSkill', () => {
  it.each(reasons)('describes reason %s', (reason, tail) => {
    expect(describeUnportableSkill({ path: '/Users/me/dev/scratch', reason })).toBe(
      `skill "/Users/me/dev/scratch" is not portable. ${tail}`,
    );
  });
});

describe('UnportableSkillError', () => {
  it('uses describeUnportableSkill for its message', () => {
    const props = { path: '/Users/me/dev/scratch', reason: 'nested-skill' as const };
    const error = new UnportableSkillError(props);

    expect(error.message).toBe(describeUnportableSkill(props));
  });

  it('carries path and reason on the instance', () => {
    const error = new UnportableSkillError({ path: '/Users/me/dev/scratch', reason: 'not-a-skill' });

    expect(error.path).toBe('/Users/me/dev/scratch');
    expect(error.reason).toBe('not-a-skill');
  });
});
