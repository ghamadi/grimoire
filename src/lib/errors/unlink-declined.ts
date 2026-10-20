import { assertUnreachable } from '@/lib/utils';
import { GrimoireError } from '@/lib/errors/grimoire-error';

/**
 * Why `link --drop` left `<workspace path>/<skill>` alone — what sits there instead
 * of the link, or that the workspace holding it does not resolve or cannot be
 * read.
 *
 * A plain string union, not `link-declined.ts`'s `{ kind: ... }` objects: no
 * reason here carries data beyond its name.
 */
export type UnlinkRefusalReason =
  'directory' | 'not-a-link' | 'foreign-symlink' | 'workspace-unreachable' | 'workspace-unreadable';

/**
 * One pair `link --drop` stepped over: a fact about the filesystem, not a mistake
 * in argv. The batch carries on past every one of them.
 */
export type UnlinkRefusal = {
  skill: string;
  workspace: string;
  path: string;
  reason: UnlinkRefusalReason;
};

/**
 * The sentence, without a `warning: ` or `error: ` prefix.
 *
 * A run that unlinked something prints these as warnings and returns; a run
 * that unlinked nothing throws them as one error. Both have to read
 * identically, or the same fact arrives in two voices.
 */
export function describeUnlinkRefusal(refusal: UnlinkRefusal): string {
  const prefix = `could not unlink ${refusal.skill} → ${refusal.workspace}: ${refusal.path}`;

  switch (refusal.reason) {
    case 'directory':
      return `${prefix} is a directory, not a link`;
    case 'not-a-link':
      return `${prefix} is not a link`;
    case 'foreign-symlink':
      return `${prefix} is a symlink pointing elsewhere`;
    case 'workspace-unreachable':
      return `${prefix} workspace path does not resolve`;
    case 'workspace-unreadable':
      return `${prefix} workspace path cannot be read`;
    default:
      assertUnreachable(refusal.reason);
  }
}

export type UnlinkDeclinedErrorProps = {
  refusals: UnlinkRefusal[];
};

/**
 * A `link --drop` run that declined every pair it was asked to remove.
 *
 * Every other command reports a refusal by throwing, and a run with nothing to
 * show for itself is a refusal. A run that did unlink something keeps its exit
 * code and prints the same sentences as warnings instead — which is why the
 * refusals survive on the instance rather than only in the message.
 */
export class UnlinkDeclinedError extends GrimoireError {
  readonly refusals: UnlinkRefusal[];

  constructor(props: UnlinkDeclinedErrorProps) {
    const { refusals } = props;

    super(describeSentences(refusals.map(describeUnlinkRefusal)));

    this.name = 'UnlinkDeclinedError';
    this.refusals = refusals;
  }
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/**
 * Join already-described sentences into the error's message.
 */
function describeSentences(sentences: string[]): string {
  const [first] = sentences;

  // With only one sentence, return it as-is
  if (first && sentences.length === 1) {
    return first;
  }

  return ['nothing unlinked:', ...sentences.map((sentence) => `  ${sentence}`)].join('\n');
}
