/**
 * Every error the CLI is expected to print, in one place.
 *
 * They live under `lib/` rather than in the module that throws them because
 * `cli.ts` needs a single discriminator, and a failure kind is rarely owned by
 * one domain for long — `DuplicateNameError` is a repo error today and a
 * workspace error tomorrow.
 */
export { GrimoireError } from './grimoire-error.ts';
export { DuplicateNameError, type DuplicateNameErrorProps } from './duplicate-name.ts';
export { EntityNotFoundError, type Entity, type EntityNotFoundErrorProps } from './entity-not-found.ts';
export {
  InvalidWorkspaceNameError,
  type InvalidWorkspaceNameErrorProps,
} from './invalid-workspace-name.ts';
export { InvalidPathError, type InvalidPathErrorProps, type InvalidPathReason } from './invalid-path.ts';
export {
  AddDeclinedError,
  describeAddRefusal,
  type AddDeclinedErrorProps,
  type AddRefusal,
} from './add-declined.ts';
export {
  CloneDeclinedError,
  describeCloneRefusal,
  type CloneDeclinedErrorProps,
  type CloneOccupant,
  type CloneRefusal,
} from './clone-declined.ts';
export {
  LinkDeclinedError,
  describeLinkRefusal,
  type LinkDeclinedErrorProps,
  type LinkOccupant,
  type LinkRefusal,
} from './link-declined.ts';
export {
  UnlinkDeclinedError,
  describeUnlinkRefusal,
  type UnlinkDeclinedErrorProps,
  type UnlinkRefusalReason,
  type UnlinkRefusal,
} from './unlink-declined.ts';
export {
  CollidingRegistrationError,
  type CollidingRegistrationErrorProps,
} from './colliding-registration.ts';
export {
  PathCollisionError,
  describeCollision,
  type PathCollisionErrorProps,
} from './path-collision.ts';
export { InvalidShapeError, type InvalidShapeErrorProps } from './invalid-shape.ts';
export {
  UnportableSkillError,
  type UnportableSkillErrorProps,
  type UnportableSkillReason,
} from './unportable-skill.ts';
export { WorkspaceInUseError, type WorkspaceInUseErrorProps } from './workspace-in-use.ts';
export {
  WorkspaceUnreadableError,
  type UnreadableWorkspace,
  type WorkspaceUnreadableErrorProps,
} from './workspace-unreadable.ts';
export { NoTerminalError, type NoTerminalErrorProps } from './no-terminal.ts';
