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
export {
  EntityNotFoundError,
  type Entity,
  type EntityNotFoundErrorProps,
  type RegistryEntity,
} from './entity-not-found.ts';
export { InvalidNameError, type InvalidNameErrorProps } from './invalid-name.ts';
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
  CloneFailedError,
  describeCloneFailure,
  type CloneFailedErrorProps,
  type CloneFailure,
} from './clone-failed.ts';
export {
  ExportDeclinedError,
  describeExportRefusal,
  type ExportDeclinedErrorProps,
  type ExportRefusal,
} from './export-declined.ts';
export {
  ExportFailedError,
  describeExportFailure,
  type ExportFailedErrorProps,
  type ExportFailure,
} from './export-failed.ts';
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
  UnreadableWorkspaceRemovalError,
  type UnreadableWorkspaceRemovalErrorProps,
} from './unreadable-workspace-removal.ts';
export {
  WorkspaceUnreadableError,
  type UnreadableWorkspace,
  type WorkspaceUnreadableErrorProps,
} from './workspace-unreadable.ts';
export { NoTerminalError, type NoTerminalErrorProps } from './no-terminal.ts';
export { GitUnavailableError } from './git-unavailable.ts';
