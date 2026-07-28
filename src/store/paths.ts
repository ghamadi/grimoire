import { homedir } from 'node:os';
import { join } from 'node:path';

/** The default store root. The CLI resolves this once and hands it to the store. */
export function resolveGrimoireHome(): string {
  return join(homedir(), '.grimoire');
}
