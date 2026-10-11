import { GrimoireError } from '@/lib/errors/grimoire-error';

/**
 * What a destination holds instead of the link `link` would have written.
 *
 * `entry` names the first file that proved the difference.
 */
export type LinkOccupant =
  | { kind: 'differing-directory'; entry: string }
  | { kind: 'not-a-directory' }
  | { kind: 'foreign-symlink' }
  | { kind: 'clone' };

/**
 * One thing `link` stepped over: a fact about the filesystem, not a mistake in
 * argv. The batch carries on past every one of them.
 */
export type LinkRefusal =
  | { kind: 'workspace-unreachable'; workspace: string; path: string }
  | { kind: 'workspace-unreadable'; workspace: string; path: string }
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
    case 'workspace-unreadable':
      return `workspace "${refusal.workspace}" was skipped: ${refusal.path} cannot be read`;
    case 'occupied':
      return `${describePair(refusal)}: ${describeOccupant(refusal)}`;
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

type OccupiedRefusal = Extract<LinkRefusal, { kind: 'occupied' }>;

function describeOccupant(refusal: OccupiedRefusal): string {
  const { occupant, path, skill, workspace } = refusal;

  switch (occupant.kind) {
    case 'differing-directory':
      return `${path} holds a directory that differs from the store copy at "${occupant.entry}" — keep it with \`grimoire clone ${skill} ${workspace}\`, or delete it yourself`;
    case 'not-a-directory':
      return `${path} is not a directory`;
    case 'foreign-symlink':
      return `${path} is a symlink pointing elsewhere`;
    case 'clone':
      return `${path} is a clone — unclone it first with \`grimoire unclone ${skill} ${workspace}\``;
  }
}
