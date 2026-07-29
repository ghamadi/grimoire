/**
 * Which registry something belongs to, named as `config.json` keys it.
 *
 * One type, not one per layer: a collision reports a registry, an error message
 * names one, and a config lookup indexes by one — they are the same fact, and a
 * second spelling is a mapping function waiting to drift.
 */
export type Registry = 'repos' | 'workspaces';

/** `repos` → `repo`: the form that reads inside a sentence. */
export function registryNoun(registry: Registry): string {
  return registry === 'repos' ? 'repo' : 'workspace';
}
