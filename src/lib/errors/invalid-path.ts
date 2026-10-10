import { normalizePath } from '#src/lib/paths';
import { GrimoireError } from './grimoire-error.ts';

export type InvalidPathReason =
  | 'missing'
  | 'not-a-directory'
  | 'not-a-skill'
  | 'not-absolute'
  | 'not-in-git-work-tree'
  | 'symlink'
  | 'unresolvable';

export type InvalidPathErrorProps = {
  path: string;
  reason: InvalidPathReason;
};

const REASON_MESSAGES: Record<InvalidPathReason, string> = {
  missing: 'does not exist',
  'not-a-directory': 'is not a directory',
  'not-a-skill': 'holds no SKILL.md',
  'not-absolute': 'must be an absolute path or start with ~/',
  'not-in-git-work-tree': 'is not inside a git work tree',
  symlink: 'is a symlink',
  // Distinct from `missing`: the entry is right there in `ls -l`, and the fix is
  // to repoint the link rather than to go looking for a directory that is gone.
  unresolvable: 'cannot be resolved: too many levels of symbolic links',
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
    // A path refused for not being absolute is echoed as typed: `normalizePath`
    // resolves it against the cwd, naming a path the user never wrote and
    // hiding the very thing being complained about.
    const path = reason === 'not-absolute' ? props.path : normalizePath(props.path);
    super(`${path} ${REASON_MESSAGES[reason]}`);

    this.name = 'InvalidPathError';
    this.path = path;
    this.reason = reason;
  }
}
