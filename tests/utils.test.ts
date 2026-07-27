import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getVersion } from '#src/lib/utils';

describe('getVersion', () => {
  it('reads the version from package.json', () => {
    // Read independently of getVersion, so this stays a real oracle for the
    // integration test below — which can only compare the CLI against itself.
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(getVersion()).toBe(version);
  });
});
