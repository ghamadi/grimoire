/**
 * Every error the CLI is expected to print, in one place.
 *
 * They live under `lib/` rather than in the module that throws them because
 * `cli.ts` needs a single discriminator, and a failure kind is rarely owned by
 * one domain for long — `DuplicateNameError` is a repo error today and a
 * workspace error tomorrow.
 */
export { GrimoireError } from '@/lib/errors/grimoire-error';
export { DuplicateNameError, type DuplicateNameErrorProps } from '@/lib/errors/duplicate-name';
export {
  EntityNotFoundError,
  type Entity,
  type EntityNotFoundErrorProps,
  type RegistryEntity,
} from '@/lib/errors/entity-not-found';
export {
  InvalidNameError,
  NAME_RULE_MESSAGE,
  type InvalidNameErrorProps,
} from '@/lib/errors/invalid-name';
export {
  InvalidPathError,
  type InvalidPathErrorProps,
  type InvalidPathReason,
} from '@/lib/errors/invalid-path';
export {
  AddDeclinedError,
  describeAddRefusal,
  type AddDeclinedErrorProps,
  type AddRefusal,
} from '@/lib/errors/add-declined';
export {
  CloneDeclinedError,
  describeCloneRefusal,
  type CloneDeclinedErrorProps,
  type CloneOccupant,
  type CloneRefusal,
} from '@/lib/errors/clone-declined';
export {
  CloneFailedError,
  describeCloneFailure,
  type CloneFailedErrorProps,
  type CloneFailure,
} from '@/lib/errors/clone-failed';
export {
  ExportDeclinedError,
  describeExportRefusal,
  type ExportDeclinedErrorProps,
  type ExportRefusal,
} from '@/lib/errors/export-declined';
export {
  ExportFailedError,
  describeExportFailure,
  type ExportFailedErrorProps,
  type ExportFailure,
} from '@/lib/errors/export-failed';
export {
  LinkDeclinedError,
  describeLinkRefusal,
  type LinkDeclinedErrorProps,
  type LinkOccupant,
  type LinkRefusal,
} from '@/lib/errors/link-declined';
export {
  UnlinkDeclinedError,
  describeUnlinkRefusal,
  type UnlinkDeclinedErrorProps,
  type UnlinkRefusalReason,
  type UnlinkRefusal,
} from '@/lib/errors/unlink-declined';
export {
  CollidingRegistrationError,
  type CollidingRegistrationErrorProps,
} from '@/lib/errors/colliding-registration';
export {
  PathCollisionError,
  describeCollision,
  type PathCollisionErrorProps,
} from '@/lib/errors/path-collision';
export { InvalidShapeError, type InvalidShapeErrorProps } from '@/lib/errors/invalid-shape';
export {
  UnportableSkillError,
  type UnportableSkillErrorProps,
  type UnportableSkillReason,
} from '@/lib/errors/unportable-skill';
export { WorkspaceInUseError, type WorkspaceInUseErrorProps } from '@/lib/errors/workspace-in-use';
export {
  UnreadableWorkspaceRemovalError,
  type UnreadableWorkspaceRemovalErrorProps,
} from '@/lib/errors/unreadable-workspace-removal';
export {
  WorkspaceUnreadableError,
  type UnreadableWorkspace,
  type WorkspaceUnreadableErrorProps,
} from '@/lib/errors/workspace-unreadable';
export { NoTerminalError, type NoTerminalErrorProps } from '@/lib/errors/no-terminal';
export { GitUnavailableError } from '@/lib/errors/git-unavailable';
