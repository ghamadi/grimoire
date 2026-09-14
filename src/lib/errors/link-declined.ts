import { GrimoireError } from './grimoire-error.ts';

/**
 * What a destination holds instead of the link `link` would have written.
 *
 * `entry` names the first file that proved the difference.
 */
export type LinkOccupant =
  | { kind: 'differing-directory'; entry: string }
  | { kind: 'not-a-directory' }
  | { kind: 'foreign-symlink' };

/**
 * One thing `link` stepped over: a fact about the filesystem, not a mistake in
 * argv. The batch carries on past every one of them.
 */
export type LinkRefusal =
  | { kind: 'workspace-unreachable'; workspace: string; path: string }
  | { kind: 'occupied'; skill: string; workspace: string; path: string; occupant: LinkOccupant }
  | { kind: 'unportable'; skill: string; workspace: string; path: string; entry: string };

/**
 * The sentence, without the refusal.
 *
 * A run that linked something prints these as warnings and returns; a run that
 * linked nothing throws them as one error. Both have to read identically, or the
 * same fact arrives in two voices.
 */
export function describeLinkRefusal(refusal: LinkRefusal): string {
  switch (refusal.kind) {
    case 'workspace-unreachable':
      return `workspace "${refusal.workspace}" was skipped: ${refusal.path} is not an existing directory`;
    case 'occupied':
      return `${describePair(refusal)}: ${describeOccupant(refusal.occupant, refusal.path)}`;
    case 'unportable':
      return `${describePair(refusal)}: ${refusal.path} holds the symlink "${refusal.entry}", so the two copies cannot be compared`;
  }
}

export type LinkDeclinedErrorProps = {
  refusals: LinkRefusal[];
};

/**
 * A `link` run that declined everything it was asked to do.
 *
 * Every other command reports a refusal by throwing, and a run with nothing to
 * show for itself is a refusal. A run that did link something keeps its exit
 * code and prints the same sentences as warnings instead — which is why the
 * refusals survive on the instance rather than only in the message.
 */
export class LinkDeclinedError extends GrimoireError {
  readonly refusals: LinkRefusal[];

  constructor(props: LinkDeclinedErrorProps) {
    super(describeRefusals(props.refusals));

    this.name = 'LinkDeclinedError';
    this.refusals = props.refusals;
  }
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** One refusal is its own sentence; a list needs the line saying what they add up to. */
function describeRefusals(refusals: LinkRefusal[]): string {
  const sentences = refusals.map(describeLinkRefusal);
  const [only] = sentences;

  if (only !== undefined && sentences.length === 1) {
    return only;
  }

  return ['nothing linked:', ...sentences.map((sentence) => `  ${sentence}`)].join('\n');
}

/** Reads as the success line it replaces: `linked <skill> → <workspace>`. */
function describePair(refusal: { skill: string; workspace: string }): string {
  return `could not link ${refusal.skill} → ${refusal.workspace}`;
}

function describeOccupant(occupant: LinkOccupant, path: string): string {
  switch (occupant.kind) {
    case 'differing-directory':
      return `${path} holds a directory that differs from the store copy at "${occupant.entry}" — keep it with \`clone\`, or delete it yourself`;
    case 'not-a-directory':
      return `${path} is not a directory`;
    case 'foreign-symlink':
      return `${path} is a symlink pointing elsewhere`;
  }
}
