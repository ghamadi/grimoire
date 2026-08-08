import { normalizePath } from '#src/lib/paths';
import { GrimoireError } from './grimoire-error.ts';

export type InvalidPathReason = 'missing' | 'not-a-directory' | 'not-a-skill';

export type InvalidPathErrorProps = {
  path: string;
  reason: InvalidPathReason;
};

const REASON_MESSAGES: Record<InvalidPathReason, string> = {
  missing: 'does not exist',
  'not-a-directory': 'is not a directory',
  'not-a-skill': 'holds no SKILL.md',
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
    const { reason } = props;
    const path = normalizePath(props.path);
    super(`${path} ${REASON_MESSAGES[reason]}`);

    this.name = 'InvalidPathError';
    this.path = path;
    this.reason = reason;
  }
}
