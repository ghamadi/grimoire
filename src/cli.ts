#!/usr/bin/env node
import { GrimoireStore } from '@/domains/grimoire-store';
import { GrimoireError } from '@/lib/errors';
import { isPermissionError } from '@/lib/fs';
import { buildProgram } from '@/program';

try {
  // `parseAsync`, not `parse`: the moment an action returns a promise, `parse`
  // resolves before it settles and a refusal escapes this catch as an unhandled
  // rejection with a zero exit code.
  await buildProgram(new GrimoireStore(GrimoireStore.resolveHome())).parseAsync();
} catch (error) {
  // Anything else that is not a GrimoireError is a bug, and a bug should look like
  // one — rethrown with its stack intact rather than dressed up as a refusal. A
  // permission error is no bug: the system's own sentence names the path to fix.
  if (!(error instanceof GrimoireError) && !isPermissionError(error)) {
    throw error;
  }

  console.error(`error: ${error.message}`);

  // Not `process.exit()`, which can truncate the write above.
  process.exitCode = 1;
}
