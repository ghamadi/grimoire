import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'grimoire-'));

  // By default, SIGINT ends a Node process on the spot: no more code runs, `finally` included. Registering any SIGINT
  // listener turns that off. Node then queues the signal, and the event loop delivers it to the listener.
  //
  // - SIGINT while `run` awaits: `onSigint` runs and removes the directory itself, because `process.exit` skips `finally`.
  // - Ctrl-C during a synchronous spawn: Ctrl-C sends SIGINT to the child as well, and the child dies. The spawn blocks
  //   the event loop meanwhile, so the signal waits in the queue. When the child's failure ends `run`, `finally`
  //   removes `onSigint`, which discards the signal, and then the directory. `onSigint` never runs here; registering
  //   it is what stopped Node from ending with the child.
  const onSigint = () => {
    rmSync(directory, { recursive: true, force: true });
    process.exit(130);
  };

  process.on('SIGINT', onSigint);

  try {
    return await run(directory);
  } finally {
    process.off('SIGINT', onSigint);
    rmSync(directory, { recursive: true, force: true });
  }
}
