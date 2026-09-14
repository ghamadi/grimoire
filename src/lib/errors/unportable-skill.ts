import { GrimoireError } from './grimoire-error.ts';

export type UnportableSkillErrorProps = {
  path: string;
  reason: 'nested-skill' | 'not-a-skill' | 'unexpected-file-type';
};

const REASON_MESSAGES = {
  'nested-skill': 'Contains a nested skill.',
  'not-a-skill': 'Is not a skill directory.',
  'unexpected-file-type': 'An unexpected file type was encountered.',
} as const;

/**
 * A skill directory holds a symlink somewhere beneath it.
 *
 * A skill is fanned out to machines the link's target does not exist on, so it
 * cannot travel, and materializing it silently would change what the author
 * wrote — refused rather than resolved.
 */
export class UnportableSkillError extends GrimoireError {
  readonly path: string;

  constructor(props: UnportableSkillErrorProps) {
    const { path, reason } = props;
    super(`skill "${path}" is not portable. ${REASON_MESSAGES[reason]}`);

    this.name = 'UnportableSkillError';
    this.path = path;
  }
}
