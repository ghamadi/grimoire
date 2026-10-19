import { GrimoireError } from '@/lib/errors/grimoire-error';

/**
 * Used when npm cannot be spawned at all: not installed, or not on `PATH`.
 */
export class NpmUnavailableError extends GrimoireError {
  constructor() {
    super('could not run npm: `grimoire update` needs it installed and on your PATH');

    this.name = 'NpmUnavailableError';
  }
}
