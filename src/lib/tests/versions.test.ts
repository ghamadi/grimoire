import { describe, expect, it } from 'vitest';
import { compareVersions } from '@/lib/versions';

describe('compareVersions', () => {
  it('is zero for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it.each([
    ['major', '2.0.0', '1.9.9'],
    ['minor', '1.3.0', '1.2.9'],
    ['patch', '1.2.4', '1.2.3'],
  ])('lets the %s decide the order', (_part, newer, older) => {
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
    expect(compareVersions(older, newer)).toBeLessThan(0);
  });

  it('compares parts as numbers, not text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
  });

  it.each(['1.2.0-beta.1', '1.2', 'v1.2.0'])('throws on %s, on either side', (version) => {
    const message = `not a major.minor.patch version: "${version}"`;

    expect(() => compareVersions(version, '1.2.0')).toThrow(message);
    expect(() => compareVersions('1.2.0', version)).toThrow(message);
  });
});
