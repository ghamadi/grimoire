import { GrimoireError } from '@/lib/errors/grimoire-error';
import { describeUnportableSkill, type UnportableSkillReason } from '@/lib/errors/unportable-skill';

/** Why `skills add` left a source alone. */
export type AddRefusal =
  /** `storePath` is the store copy's path; `entry` names the first file the comparison found differing. */
  | { kind: 'differs'; skill: string; storePath: string; entry: string }
  | { kind: 'unportable'; skill: string; location: string; reason: UnportableSkillReason }
  /** `root` is the side holding the symlink: the source's location or the store copy's path. `entry` names it. */
  | { kind: 'incomparable'; skill: string; root: string; entry: string }
  | { kind: 'unreadable'; skill: string; path: string }
  /** `reason` is the system's own sentence, for a denial anywhere in copying or comparing. */
  | { kind: 'inaccessible'; skill: string; reason: string };

/**
 * `could not add <skill>: …` — no `warning: ` or `error: ` prefix.
 *
 * A run that added something prints these as warnings and returns; a run that
 * added nothing throws them as one error. Both have to read identically, or
 * the same fact arrives in two voices.
 */
export function describeAddRefusal(refusal: AddRefusal): string {
  switch (refusal.kind) {
    case 'differs':
      return `${describePrefix(refusal)}: the store holds a different ${refusal.skill}, differing at "${refusal.entry}" — edit or replace ${refusal.storePath}`;
    case 'unportable':
      return `${describePrefix(refusal)}: ${describeUnportableSkill({ location: refusal.location, reason: refusal.reason })}`;
    case 'incomparable':
      return `${describePrefix(refusal)}: ${refusal.root} holds the symlink "${refusal.entry}", so the two copies cannot be compared`;
    case 'unreadable':
      return `${describePrefix(refusal)}: ${refusal.path} cannot be read`;
    case 'inaccessible':
      return `${describePrefix(refusal)}: ${refusal.reason}`;
  }
}

export type AddDeclinedErrorProps = {
  refusals: AddRefusal[];
};

/**
 * An `add` run that declined every source it was asked to add.
 *
 * Every other command reports a refusal by throwing, and a run with nothing to
 * show for itself is a refusal. A run that did add something keeps its exit
 * code and prints the same sentences as warnings instead — which is why the
 * refusals survive on the instance rather than only in the message.
 */
export class AddDeclinedError extends GrimoireError {
  readonly refusals: AddRefusal[];

  constructor(props: AddDeclinedErrorProps) {
    super(describeRefusals(props.refusals));

    this.name = 'AddDeclinedError';
    this.refusals = props.refusals;
  }
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** Reads as the negative of the success line it replaces: `added <skill>`. */
function describePrefix(refusal: { skill: string }): string {
  return `could not add ${refusal.skill}`;
}

/** One refusal is its own sentence; a list needs the line saying what they add up to. */
function describeRefusals(refusals: AddRefusal[]): string {
  const sentences = refusals.map(describeAddRefusal);
  const [only] = sentences;

  if (only !== undefined && sentences.length === 1) {
    return only;
  }

  return ['nothing added:', ...sentences.map((sentence) => `  ${sentence}`)].join('\n');
}
