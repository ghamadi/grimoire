import { GrimoireError } from './grimoire-error.ts';

/**
 * What the destination holds instead of the copy `clone` would have written.
 */
export type CloneOccupant =
  | { kind: 'unrecorded-directory' }
  | { kind: 'not-a-skill' }
  | { kind: 'not-a-directory' }
  | { kind: 'foreign-symlink' };

/**
 * One thing `clone` stepped over: a fact about the filesystem, not a mistake
 * in argv. The batch carries on past every one of them.
 */
export type CloneRefusal =
  /** `path` is the workspace path that did not resolve. */
  | { kind: 'workspace-unreachable'; skill: string; workspace: string; path: string }
  /** `path` is the workspace path that cannot be read. */
  | { kind: 'workspace-unreadable'; skill: string; workspace: string; path: string }
  /** `path` is `<dest>` — `<workspace path>/<skill>`. */
  | { kind: 'occupied'; skill: string; workspace: string; path: string; occupant: CloneOccupant };

/**
 * `could not clone <skill> → <workspace>: …` — no `warning: ` or `grimoire: ` prefix.
 *
 * A run that cloned something prints these as warnings and returns; a run
 * that cloned nothing throws them as one error. Both have to read
 * identically, or the same fact arrives in two voices.
 */
export function describeCloneRefusal(refusal: CloneRefusal): string {
  switch (refusal.kind) {
    case 'workspace-unreachable':
      return `${describePair(refusal)}: ${refusal.path} is not an existing directory`;
    case 'workspace-unreadable':
      return `${describePair(refusal)}: ${refusal.path} cannot be read`;
    case 'occupied':
      return `${describePair(refusal)}: ${describeOccupant(refusal.occupant, refusal.path)}`;
  }
}

export type CloneDeclinedErrorProps = {
  refusals: CloneRefusal[];
};

/**
 * A `clone` run that declined every pair it was asked to clone.
 *
 * Every other command reports a refusal by throwing, and a run with nothing to
 * show for itself is a refusal. A run that did clone something keeps its exit
 * code and prints the same sentences as warnings instead — which is why the
 * refusals survive on the instance rather than only in the message.
 */
export class CloneDeclinedError extends GrimoireError {
  readonly refusals: CloneRefusal[];

  constructor(props: CloneDeclinedErrorProps) {
    super(describeRefusals(props.refusals));

    this.name = 'CloneDeclinedError';
    this.refusals = props.refusals;
  }
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** One refusal is its own sentence; a list needs the line saying what they add up to. */
function describeRefusals(refusals: CloneRefusal[]): string {
  const sentences = refusals.map(describeCloneRefusal);
  const [only] = sentences;

  if (only !== undefined && sentences.length === 1) {
    return only;
  }

  return ['nothing cloned:', ...sentences.map((sentence) => `  ${sentence}`)].join('\n');
}

/** Reads as the success line it replaces: `cloned <skill> → <workspace>`. */
function describePair(refusal: { skill: string; workspace: string }): string {
  return `could not clone ${refusal.skill} → ${refusal.workspace}`;
}

function describeOccupant(occupant: CloneOccupant, path: string): string {
  switch (occupant.kind) {
    case 'unrecorded-directory':
      return `${path} already holds a directory — rerun with --adopt to keep it as the clone`;
    case 'not-a-skill':
      return `${path} holds no SKILL.md, so it cannot be adopted`;
    case 'not-a-directory':
      return `${path} is not a directory`;
    case 'foreign-symlink':
      return `${path} is a symlink pointing elsewhere`;
  }
}
