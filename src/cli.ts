#!/usr/bin/env node
import { GrimoireError } from '#src/lib/errors/index';
import { buildProgram } from '#src/program';
import { GrimoireStore, resolveGrimoireHome } from '#src/store/index';

try {
  // `parseAsync`, not `parse`: the moment an action returns a promise, `parse`
  // resolves before it settles and a refusal escapes this catch as an unhandled
  // rejection with a zero exit code.
  await buildProgram(new GrimoireStore(resolveGrimoireHome())).parseAsync();
} catch (error) {
  // Anything that is not a GrimoireError is a bug, and a bug should look like
  // one — rethrown with its stack intact rather than dressed up as a refusal.
  if (!(error instanceof GrimoireError)) {
    throw error;
  }

  console.error(`grimoire: ${error.message}`);

  // Not `process.exit()`, which can truncate the write above.
  process.exitCode = 1;
}
