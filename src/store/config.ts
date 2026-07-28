import { z } from 'zod';

export const repoSchema = z.strictObject({
  path: z.string().trim().min(1),
  mode: z.enum(['read-only', 'read-write']),
});

export const workspaceSchema = z.strictObject({
  path: z.string().min(1),
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
  repos: z.record(z.string(), repoSchema).default({}),
  workspaces: z.record(z.string(), workspaceSchema).default({}),
  ignore: z.array(z.string()).default([]),
});

export type Repo = z.infer<typeof repoSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Config = z.infer<typeof configSchema>;

export function defaultConfig(): Config {
  return configSchema.parse({});
}
