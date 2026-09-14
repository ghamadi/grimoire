import { z } from 'zod';
import { normalizePath } from '#src/lib/paths';
import { canBeRegistered } from '../helpers/registered-path.ts';
import { InvalidShapeError } from '../../../lib/errors/invalid-shape.ts';

// ----------------------------------------------------------------------------
// SCHEMAS
// ----------------------------------------------------------------------------

const registeredPath = z
  .string()
  .trim()
  .min(1)
  .refine(canBeRegistered, { error: 'must be an absolute path or start with ~/' })
  .transform(normalizePath);

const workspaceConfigSchema = z.strictObject({
  path: registeredPath,
  autoLink: z.boolean(),
});

/**
 * Both arms are strict, which is what rejects an entry carrying `workspace`
 * *and* `path` — one directory never collects two records. The custom message
 * also turns the legacy bare-string form (`clones: ["personal"]`) into a
 * sentence rather than zod's default `Invalid input`.
 */
const cloneRecordSchema = z.union(
  [z.strictObject({ workspace: z.string().min(1) }), z.strictObject({ path: z.string().min(1) })],
  { error: 'a clone entry must have exactly one of "workspace" or "path"' },
);

const skillSchema = z.strictObject({
  clones: z.array(cloneRecordSchema).default([]),
});

/**
 * `strictObject` rather than zod's default of stripping unknown keys: a save
 * rewrites the whole file, so a key silently dropped on load is silently gone
 * from disk on the next save. That makes a version downgrade destructive — an
 * older grimoire would erase whatever a newer one recorded — and refusing to
 * parse is the cheaper answer.
 *
 * `workspaces` and `skills` are records rather than strict objects: their keys
 * are names the user chose, so there is no such thing as an unrecognized one.
 */
const stateDataSchema = z.strictObject({
  workspaces: z.record(z.string(), workspaceConfigSchema).default({}),
  skills: z.record(z.string(), skillSchema).default({}),
  ignore: z.array(z.string()).default(['.DS_Store']),
});

export type CloneRecord = z.infer<typeof cloneRecordSchema>;
type WorkspaceRecord = z.infer<typeof workspaceConfigSchema>;
type SkillRecord = z.infer<typeof skillSchema>;
type StateData = z.infer<typeof stateDataSchema>;
type ByName<T> = Readonly<Record<string, Readonly<T>>>;

// ----------------------------------------------------------------------------
// VALUE OBJECT
// ----------------------------------------------------------------------------

/**
 * Everything grimoire persists about a store, in one document it alone writes.
 *
 * Registrations and clone records live together because a command that touches
 * both — `workspace remove` is the one — has to leave them agreed. Two
 * documents means two writes and a window where a crash strands cloned
 * directories that nothing on disk still claims.
 */
export class StoreState {
  private readonly data: StateData;

  /**
   * Private to allow trusted instantiation within the class, skipping the validation step,
   * while `parse` remains the only door for instantiating StoreState with external data.
   *
   * @param data - the input data trusted to be in the correct format.
   * @returns a new StoreState instance.
   */
  private constructor(data: StateData) {
    this.data = freeze(data);
  }

  /**
   * Validates the input data and instantiates a new StoreState instance.
   */
  static parse(input: unknown): StoreState {
    return new StoreState(parseOrThrow(stateDataSchema, input));
  }

  static default(): StoreState {
    return StoreState.parse({});
  }

  get workspacesRegistry(): ByName<WorkspaceRecord> {
    return this.data.workspaces;
  }

  get skillsByName(): ByName<SkillRecord> {
    return this.data.skills;
  }

  get ignoredGlobs(): readonly string[] {
    return this.data.ignore;
  }

  // --------------------------------------------------------------------------
  // WORKSPACES
  // --------------------------------------------------------------------------

  /**
   * @returns a new config with the new workspace set.
   */
  withWorkspace(params: { name: string } & WorkspaceRecord): StoreState {
    const { name, ...input } = params;
    const workspace = parseOrThrow(workspaceConfigSchema, input);

    return this.with({ workspaces: { ...this.data.workspaces, [name]: workspace } });
  }

  /**
   * @returns a new config with the workspace removed, or an equivalent one when no
   * workspace is filed under that name.
   */
  withoutWorkspace(name: string): StoreState {
    const { [name]: _removed, ...workspaces } = this.data.workspaces;

    return this.with({ workspaces });
  }

  // --------------------------------------------------------------------------
  // CLONE RECORDS
  // --------------------------------------------------------------------------

  /**
   * @returns The skills recorded as cloned into the workspace, sorted by name.
   *
   * Only the name-keyed records answer here: a `{ path }` record keeps
   * resolving after the workspace is unregistered, so it is never at stake.
   */
  skillsClonedIntoWorkspace(workspace: string): string[] {
    return Object.entries(this.data.skills)
      .filter(([, skill]) => skill.clones.some(isCloneInto(workspace)))
      .map(([skill]) => skill)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * @returns a new config with the workspace's clones recorded by path instead.
   *
   * The path is the workspace's own, so a record keeps naming the directory it
   * always named — only the way it gets there changes, from a registry lookup
   * that is about to fail to the answer that lookup would have given.
   */
  withClonesRecordedByPath(params: { workspace: string; path: string }): StoreState {
    const { workspace } = params;
    const byPath = parseOrThrow(cloneRecordSchema, { path: params.path });

    return this.mapClones((record) => (isCloneInto(workspace)(record) ? byPath : record));
  }

  /**
   * @returns a new config with the workspace's clones dropped.
   *
   * The skill's key stays with an empty array: `clones: []` means "never
   * cloned", which is what a forgotten record leaves behind.
   */
  withoutClonesIntoWorkspace(workspace: string): StoreState {
    return this.mapClones((record) => (isCloneInto(workspace)(record) ? undefined : record));
  }

  /**
   * @returns the frozen config data object.
   */
  toJSON(): StateData {
    return this.data;
  }

  // --------------------------------------------------------------------------
  // PRIVATE METHODS
  // --------------------------------------------------------------------------

  /**
   * Every section this instance holds, with the named ones replaced.
   *
   * The spread is the point: a transformation naming one section cannot forget
   * to carry the others, which in a document holding registrations *and* clone
   * records would drop the half it was not thinking about.
   */
  private with(changes: Partial<StateData>): StoreState {
    return new StoreState({ ...this.data, ...changes });
  }

  /** Every skill's records rewritten, dropping the ones mapped to `undefined`. */
  private mapClones(rewrite: (record: CloneRecord) => CloneRecord | undefined): StoreState {
    return this.with({
      skills: Object.fromEntries(
        Object.entries(this.data.skills).map(([name, skill]) => [
          name,
          { ...skill, clones: skill.clones.map(rewrite).filter(isRecord) },
        ]),
      ),
    });
  }
}

// ----------------------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------------------

/** The parsed input, or the one error type a malformed document earns. */
function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new InvalidShapeError({ message: z.prettifyError(result.error) });
  }

  return result.data;
}

/** Matches the records a workspace name owns, which unregistering it invalidates. */
function isCloneInto(workspace: string): (record: CloneRecord) => boolean {
  return (record) => 'workspace' in record && record.workspace === workspace;
}

function isRecord(record: CloneRecord | undefined): record is CloneRecord {
  return record !== undefined;
}

/**
 * Freezes the data, making it immutable.
 * This helps establish safe getters without needing to copy on each read.
 */
function freeze(data: StateData): StateData {
  for (const workspace of Object.values(data.workspaces)) {
    Object.freeze(workspace);
  }

  for (const skill of Object.values(data.skills)) {
    for (const record of skill.clones) {
      Object.freeze(record);
    }

    Object.freeze(skill.clones);
    Object.freeze(skill);
  }

  Object.freeze(data.workspaces);
  Object.freeze(data.skills);
  Object.freeze(data.ignore);

  return Object.freeze(data);
}
