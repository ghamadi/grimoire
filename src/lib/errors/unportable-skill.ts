import { GrimoireError } from '@/lib/errors/grimoire-error';

export type UnportableSkillReason = 'nested-skill' | 'not-a-skill' | 'unexpected-file-type';

export type UnportableSkillErrorProps = {
  path: string;
  reason: UnportableSkillReason;
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
  readonly reason: UnportableSkillReason;

  constructor(props: UnportableSkillErrorProps) {
    super(describeUnportableSkill({ location: props.path, reason: props.reason }));

    this.name = 'UnportableSkillError';
    this.path = props.path;
    this.reason = props.reason;
  }
}

/**
 * The sentence, without the refusal.
 *
 * The same fact reaches the user from two places — thrown by `Skill.verify`,
 * and again inside an add refusal — so the sentence lives here rather than in
 * either error, or it arrives in two voices.
 */
export function describeUnportableSkill(props: {
  location: string;
  reason: UnportableSkillReason;
}): string {
  return `skill "${props.location}" is not portable. ${REASON_MESSAGES[props.reason]}`;
}
