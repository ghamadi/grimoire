import { GrimoireError } from '@/lib/errors/grimoire-error';

/**
 * Used when git cannot be spawned at all: not installed, or not on `PATH`.
 */
export class GitUnavailableError extends GrimoireError {
  constructor() {
    super('could not run git: grimoire needs it installed and on your PATH');

    this.name = 'GitUnavailableError';
  }
}
