import { describe, expect, it } from 'vitest';
import { createIgnoreMatcher } from '../ignore.ts';

describe('createIgnoreMatcher', () => {
  it('matches a bare name at the root', () => {
    const ignores = createIgnoreMatcher(['.DS_Store']);

    expect(ignores('.DS_Store')).toBe(true);
  });

  it('matches a bare name several levels deep', () => {
    const ignores = createIgnoreMatcher(['.DS_Store']);

    expect(ignores('a/b/c/.DS_Store')).toBe(true);
  });

  it('anchors a pattern containing / to the skill root', () => {
    const ignores = createIgnoreMatcher(['build/x.js']);

    expect(ignores('build/x.js')).toBe(true);
    expect(ignores('a/build/x.js')).toBe(false);
  });

  it('does not cross a separator with *', () => {
    const ignores = createIgnoreMatcher(['*.js']);

    expect(ignores('b.js')).toBe(true);
    expect(ignores('a/b.js')).toBe(true); // matched against the basename, no '/' in the pattern
  });

  it('crosses a separator with ** in an anchored pattern', () => {
    const ignores = createIgnoreMatcher(['a/**/x.js']);

    expect(ignores('a/b/c/x.js')).toBe(true);
  });

  it('does not cross a separator with * in an anchored pattern', () => {
    const ignores = createIgnoreMatcher(['a/*/x.js']);

    expect(ignores('a/b/x.js')).toBe(true);
    expect(ignores('a/b/c/x.js')).toBe(false);
  });

  it('expands braces', () => {
    const ignores = createIgnoreMatcher(['{build,dist}']);

    expect(ignores('build')).toBe(true);
    expect(ignores('dist')).toBe(true);
    expect(ignores('other')).toBe(false);
  });

  it('never matches SKILL.md at the skill root, whatever the pattern', () => {
    expect(createIgnoreMatcher(['*.md'])('SKILL.md')).toBe(false);
    expect(createIgnoreMatcher(['SKILL.md'])('SKILL.md')).toBe(false);
    expect(createIgnoreMatcher(['*'])('SKILL.md')).toBe(false);
  });

  it('matches a nested SKILL.md, which is not the skill root manifest', () => {
    const ignores = createIgnoreMatcher(['*.md']);

    expect(ignores('reference/SKILL.md')).toBe(true);
  });

  it('matches nothing for an empty pattern list', () => {
    const ignores = createIgnoreMatcher([]);

    expect(ignores('anything')).toBe(false);
  });

  it('throws on an absolute path', () => {
    const ignores = createIgnoreMatcher(['.DS_Store']);

    expect(() => ignores('/abs/.DS_Store')).toThrow();
  });
});
