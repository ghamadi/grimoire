import { GrimoireError } from './grimoire-error.ts';

export type UnportableSkillErrorProps = {
  path: string;
  entry: string;
};

/**
 * A skill directory holds a symlink somewhere beneath it.
 *
 * A skill is fanned out to machines the link's target does not exist on, so it
 * cannot travel, and materializing it silently would change what the author
 * wrote — refused rather than resolved.
 */
export class UnportableSkillError extends GrimoireError {
  readonly path: string;
  readonly entry: string;

  constructor(props: UnportableSkillErrorProps) {
    const { path, entry } = props;
    super(`skill "${path}" is not portable: "${entry}" is a symlink`);

    this.name = 'UnportableSkillError';
    this.path = path;
    this.entry = entry;
  }
}
