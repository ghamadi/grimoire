import { describeSentences } from '@/lib/errors/clone-sentences';
import { GrimoireError } from '@/lib/errors/grimoire-error';

export type TrashFailure = {
  path: string;
  error: Error;
};

export type TrashEmptyFailedErrorProps = {
  failures: TrashFailure[];
};

export class TrashEmptyFailedError extends GrimoireError {
  readonly failures: TrashFailure[];

  constructor(props: TrashEmptyFailedErrorProps) {
    super(
      describeSentences({
        header: 'deletions failed:',
        sentences: props.failures.map(({ path, error }) => `failed to delete ${path}: ${error.message}`),
      }),
    );

    this.name = 'TrashEmptyFailedError';
    this.failures = props.failures;
  }
}
