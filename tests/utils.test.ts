import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getPackageName, getVersion } from '@/lib/utils';

describe('getVersion', () => {
  it('reads the version from package.json', () => {
    // Read independently of getVersion, so this stays a real oracle for the
    // integration test in tests/cli.test.ts — which can only compare the CLI against itself.
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(getVersion()).toBe(version);
  });
});

describe('getPackageName', () => {
  it('reads the name from package.json', () => {
    const { name } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string;
    };

    expect(getPackageName()).toBe(name);
  });
});
