import { readFileSync } from 'node:fs';
import { z } from 'zod';

const packageJsonSchema = z.object({
  version: z.string(),
});

export function getVersion() {
  const { version } = packageJsonSchema.parse(
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')),
  );

  return version;
}

export function assertUnreachable(value: never): never {
  throw new Error(`Unreachable code: ${String(value)}`);
}
