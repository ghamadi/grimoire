import { describeSentences } from '@/lib/errors/clone-sentences';
import { GrimoireError } from '@/lib/errors/grimoire-error';

/**
 * What the destination holds instead of the copy `clone` would have written.
 */
export type CloneOccupant =
  { kind: 'not-a-skill' } | { kind: 'not-a-directory' } | { kind: 'foreign-symlink' };

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
 * `could not clone <skill> → <workspace>: …` — no `warning: ` or `error: ` prefix.
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
    super(
      describeSentences({
        header: 'nothing cloned:',
        sentences: props.refusals.map(describeCloneRefusal),
      }),
    );

    this.name = 'CloneDeclinedError';
    this.refusals = props.refusals;
  }
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** Reads as the success line it replaces: `cloned <skill> → <workspace>`. */
function describePair(refusal: { skill: string; workspace: string }): string {
  return `could not clone ${refusal.skill} → ${refusal.workspace}`;
}

function describeOccupant(occupant: CloneOccupant, path: string): string {
  switch (occupant.kind) {
    case 'not-a-skill':
      return `${path} is a directory with no SKILL.md`;
    case 'not-a-directory':
      return `${path} is not a directory`;
    case 'foreign-symlink':
      return `${path} is a symlink pointing elsewhere`;
  }
}
