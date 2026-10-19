import packageJson from '@package.json' with { type: 'json' };

export function getVersion(): string {
  return packageJson.version;
}

export function getPackageName(): string {
  return packageJson.name;
}

export function assertUnreachable(value: never): never {
  throw new Error(`Unreachable code: ${String(value)}`);
}
