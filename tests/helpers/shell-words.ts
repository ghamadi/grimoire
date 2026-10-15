import { execFileSync } from 'node:child_process';

/** The words that `/bin/sh` reads from `commandText`. */
export function getShellWords(commandText: string): string[] {
  const output = execFileSync('/bin/sh', ['-c', `printf '%s\\0' ${commandText}`], {
    encoding: 'utf8',
  });

  return output.split('\0').slice(0, -1);
}
