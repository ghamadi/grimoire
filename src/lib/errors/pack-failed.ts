import { describeSentences } from '@/lib/errors/clone-sentences';
import { GrimoireError } from '@/lib/errors/grimoire-error';

export type PackFailure = {
  skill: string;
  zipPath: string;
  error: Error;
};

export function describePackFailure(failure: PackFailure): string {
  return `failed to pack ${failure.skill} → ${failure.zipPath}: ${failure.error.message}`;
}

export type PackFailedErrorProps = {
  failures: PackFailure[];
};

export class PackFailedError extends GrimoireError {
  readonly failures: PackFailure[];

  constructor(props: PackFailedErrorProps) {
    super(
      describeSentences({
        header: 'packs failed:',
        sentences: props.failures.map(describePackFailure),
      }),
    );

    this.name = 'PackFailedError';
    this.failures = props.failures;
  }
}
