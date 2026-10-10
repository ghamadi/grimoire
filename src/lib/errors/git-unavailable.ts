import { GrimoireError } from './grimoire-error.ts';

/**
 * Used when git cannot be spawned at all: not installed, or not on `PATH`.
 */
export class GitUnavailableError extends GrimoireError {
  constructor() {
    super('could not run git: repos need it installed and on your PATH');

    this.name = 'GitUnavailableError';
  }
}
