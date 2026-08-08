import { isAbsolute, sep } from 'node:path';
import { z } from 'zod';
import { normalizePath } from '#src/lib/paths';

/**
 * Every registered path, in both registries. Normalizing here makes "absolute
 * and `~`-expanded" a postcondition of loading rather than something each
 * consumer has to remember, and the consumers hand these straight to the
 * filesystem.
 *
 * A relative path is refused rather than repaired: `normalizePath` would resolve
 * it against the cwd, so accepting one means a hand-edited config resolves
 * differently depending on where grimoire ran — and the next save writes that
 * answer back.
 */
const registeredPath = z
  .string()
  .trim()
  .min(1)
  .refine((path) => isAbsolute(path) || path === '~' || path.startsWith(`~${sep}`), {
    error: 'must be an absolute path or start with ~/',
  })
  .transform(normalizePath);

/** The value half of a `repos` entry — config.json supplies the name as the key. */
export const repoConfigSchema = z.strictObject({
  path: registeredPath,
  mode: z.enum(['read-only', 'read-write']),
});

/**
 * Derived from the schema so commander's `--mode` choices and zod's enum cannot
 * drift. The schema itself stays private — a caller holding it is a caller
 * about to write config.json behind the store's back — but a constant read off
 * it is safe to hand out.
 */
export const repoModes = repoConfigSchema.shape.mode.options;

/** The value half of a `workspaces` entry — config.json supplies the name as the key. */
export const workspaceConfigSchema = z.strictObject({
  path: registeredPath,
  autoLink: z.boolean(),
});

/**
 * `strictObject` rather than zod's default of stripping unknown keys: a save
 * rewrites the whole file, so a key silently dropped on load is silently gone
 * from disk on the next save. Typing `"repo"` for `"repos"` would look
 * accepted, do nothing, and destroy the edit.
 *
 * The per-field `.default()` calls make `parse({})` the single source of truth
 * for the defaults, so a field added later cannot be forgotten in a
 * hand-written constant.
 */
export const configSchema = z.strictObject({
  repos: z.record(z.string(), repoConfigSchema).default({}),
  workspaces: z.record(z.string(), workspaceConfigSchema).default({}),
  ignore: z.array(z.string()).default(['.DS_Store']),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type Config = z.infer<typeof configSchema>;

export function defaultConfig(): Config {
  return configSchema.parse({});
}
