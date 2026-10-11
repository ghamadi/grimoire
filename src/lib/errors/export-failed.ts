import { describeSentences } from '@/lib/errors/clone-sentences';
import { GrimoireError } from '@/lib/errors/grimoire-error';

/**
 * One skill whose write failed: a fact about the filesystem, not a mistake in
 * argv. The batch carries on past every one of them.
 */
export type ExportFailure = {
  skill: string;
  repo: string;
  /** `<dest>` — `<repo path>/<skill>`. */
  path: string;
  error: Error;
};

/**
 * `failed to export <skill> → <repo>: <reason>` — no `error: ` prefix.
 *
 * Not `could not export`: that is a decline, which touched nothing.
 */
export function describeExportFailure(failure: ExportFailure): string {
  return `failed to export ${failure.skill} → ${failure.repo}: ${failure.error.message}`;
}

export type ExportFailedErrorProps = {
  failures: ExportFailure[];
};

/**
 * An `export` run in which at least one skill's write failed.
 *
 * Thrown by the command after it has printed every other line, so the failures
 * survive on the instance as well as in the message.
 */
export class ExportFailedError extends GrimoireError {
  readonly failures: ExportFailure[];

  constructor(props: ExportFailedErrorProps) {
    super(
      describeSentences({
        header: 'exports failed:',
        sentences: props.failures.map(describeExportFailure),
      }),
    );

    this.name = 'ExportFailedError';
    this.failures = props.failures;
  }
}
