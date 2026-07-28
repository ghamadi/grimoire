import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGrimoireHome } from '../index.ts';

describe('resolveGrimoireHome', () => {
  it('is .grimoire under the home directory', () => {
    expect(resolveGrimoireHome()).toBe(join(homedir(), '.grimoire'));
  });
});
