import { z } from 'zod';

/**
 * Both arms are strict, which is what rejects an entry carrying `workspace`
 * *and* `path` — one directory never collects two records. The custom message
 * also turns the legacy bare-string form (`clones: ["personal"]`) into a
 * sentence rather than zod's default `Invalid input`.
 */
export const cloneRecordSchema = z.union(
  [z.strictObject({ workspace: z.string().min(1) }), z.strictObject({ path: z.string().min(1) })],
  { error: 'a clone entry must have exactly one of "workspace" or "path"' },
);

export const skillStateSchema = z.strictObject({
  clones: z.array(cloneRecordSchema).default([]),
});

/**
 * A record, not a strictObject: the top-level keys here are skill names, so
 * there is no such thing as an unrecognized key.
 */
export const stateSchema = z.record(z.string(), skillStateSchema);

export type CloneRecord = z.infer<typeof cloneRecordSchema>;
export type SkillState = z.infer<typeof skillStateSchema>;
export type State = z.infer<typeof stateSchema>;

export function defaultState(): State {
  return stateSchema.parse({});
}
