import { describeSentences } from '@/lib/errors/clone-sentences';
import { GrimoireError } from '@/lib/errors/grimoire-error';

/**
 * One pair whose write failed: a fact about the filesystem, not a mistake in
 * argv. The batch carries on past every one of them.
 */
export type CloneFailure = {
  skill: string;
  workspace: string;
  /** `<dest>` — `<workspace path>/<skill>`. */
  path: string;
  error: Error;
};

/**
 * `failed to clone <skill> → <workspace>: <reason>` — no `error: ` prefix.
 *
 * Not `could not clone`: that is a decline, which touched nothing.
 */
export function describeCloneFailure(failure: CloneFailure): string {
  return `failed to clone ${failure.skill} → ${failure.workspace}: ${failure.error.message}`;
}

export type CloneFailedErrorProps = {
  failures: CloneFailure[];
};

/**
 * A `clone` run in which at least one pair's write failed.
 *
 * Thrown by the command after it has printed every other line, so the failures
 * survive on the instance as well as in the message.
 */
export class CloneFailedError extends GrimoireError {
  readonly failures: CloneFailure[];

  constructor(props: CloneFailedErrorProps) {
    super(
      describeSentences({
        header: 'clones failed:',
        sentences: props.failures.map(describeCloneFailure),
      }),
    );

    this.name = 'CloneFailedError';
    this.failures = props.failures;
  }
}
