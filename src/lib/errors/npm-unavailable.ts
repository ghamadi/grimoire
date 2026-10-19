import { GrimoireError } from '@/lib/errors/grimoire-error';

export class NpmUnavailableError extends GrimoireError {
  constructor() {
    super('could not run npm: `grimoire update` needs it installed and on your PATH');

    this.name = 'NpmUnavailableError';
  }
}
