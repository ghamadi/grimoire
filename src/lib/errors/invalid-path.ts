import { GrimoireError } from './grimoire-error.ts';

export type InvalidPathReason = 'missing' | 'not-a-directory';

export type InvalidPathErrorProps = {
  path: string;
  reason: InvalidPathReason;
};

/**
 * A path handed to a command cannot be used as a directory.
 *
 * A registered path that goes missing *later* is a different event, reported by
 * `status` rather than refused here.
 */
export class InvalidPathError extends GrimoireError {
  readonly path: string;
  readonly reason: InvalidPathReason;

  constructor(props: InvalidPathErrorProps) {
    const { path, reason } = props;
    super(`${path} ${reason === 'missing' ? 'does not exist' : 'is not a directory'}`);

    this.name = 'InvalidPathError';
    this.path = path;
    this.reason = reason;
  }
}
