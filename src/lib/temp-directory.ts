import { mkdtempSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

// SIGTERM stays out: `kill` signals this process alone, so a child blocking the event loop keeps running, and a listener
// would hold the signal until the spawn ends, or discard it.
const CLEANUP_SIGNALS = ['SIGINT', 'SIGHUP'] as const;

export async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'grimoire-'));

  // By default, SIGINT and SIGHUP end a Node process on the spot: no more code runs, `finally` included. Registering a
  // listener for a signal turns that off. Node then queues the signal, and the event loop delivers it to the listener.
  //
  // - A signal while `run` awaits: `onSignal` runs and removes the directory itself, because `process.exit` skips
  //   `finally`.
  // - A signal during a synchronous spawn: Ctrl-C and a closed terminal signal the child as well, and the child dies.
  //   The spawn blocks the event loop meanwhile, so the signal waits in the queue. When the child's failure ends `run`,
  //   `finally` removes `onSignal`, which discards the signal, and then the directory. `onSignal` never runs here;
  //   registering it is what stopped Node from ending with the child.
  const onSignal = (signal: NodeJS.Signals) => {
    rmSync(directory, { recursive: true, force: true });
    process.exit(128 + constants.signals[signal]);
  };

  for (const signal of CLEANUP_SIGNALS) {
    process.on(signal, onSignal);
  }

  try {
    return await run(directory);
  } finally {
    for (const signal of CLEANUP_SIGNALS) {
      process.off(signal, onSignal);
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
