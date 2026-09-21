import { isCancel, multiselect } from '@clack/prompts';
import type { SkillSource } from '#src/domains/skill/index';

export type SkillPicker = {
  /** Whether a person is there to answer. */
  isInteractive: () => boolean;
  /** The sources chosen; empty when none were chosen or the prompt was cancelled. */
  pick: (params: { sources: SkillSource[] }) => Promise<SkillSource[]>;
};

/** `@clack/prompts`' multiselect, over `process.stdin.isTTY`. */
export const clackSkillPicker: SkillPicker = {
  isInteractive: () => process.stdin.isTTY === true,

  pick: async ({ sources }) => {
    const selection = await multiselect({
      message: 'Select the skills to add',
      options: sources.map((source) => ({ value: source, label: source.name, hint: source.path })),
      required: false,
    });

    return isCancel(selection) ? [] : selection;
  },
};
