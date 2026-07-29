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
export { InvalidPathError, type InvalidPathErrorProps, type InvalidPathReason } from './invalid-path.ts';
export { PathCollisionError, type PathCollisionErrorProps } from './path-collision.ts';
export { StoreFileError, type StoreFileErrorProps } from './store-file-error.ts';
export { UnknownNameError, type UnknownNameErrorProps } from './unknown-name.ts';
