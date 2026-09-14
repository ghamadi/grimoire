import { GrimoireError } from './grimoire-error.ts';

export type InvalidShapeErrorProps = {
  message: string;
};

/**
 * A store file on disk could not be read as the shape it is supposed to hold.
 *
 * The message always leads with the absolute path, because the fix is always
 * "go edit that file".
 */
export class InvalidShapeError extends GrimoireError {
  readonly expected: unknown;
  readonly actual: unknown;

  constructor(props: InvalidShapeErrorProps) {
    const { message } = props;
    super(message);

    this.name = 'InvalidShapeError';
  }
}
