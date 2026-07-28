/**
 * The store's public surface.
 *
 * Everything else under `store/` is an implementation detail of `GrimoireStore`
 * — the zod schemas, the JSON file helpers, and the `default*` fallbacks a fresh
 * root loads as. Schemas stay in especially: config.json is validated on the way
 * through the store, so a caller reaching for `configSchema` is a caller about
 * to write the file behind the store's back.
 */
export { StoreFileError } from './errors.ts';
export { resolveGrimoireHome } from './paths.ts';
export { GrimoireStore, type StorePaths } from './store.ts';
export type { Config, Repo, Workspace } from './config.ts';
export type { CloneRecord, SkillState, State } from './state.ts';
