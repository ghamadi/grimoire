import { isCancel, multiselect } from '@clack/prompts';

export type PickerChoice<T> = { value: T; label: string; hint?: string };

export type Picker = {
  isInteractive: () => boolean;
  /** [] when nothing is chosen or the prompt is cancelled. */
  pick: <T>(params: { message: string; choices: PickerChoice<T>[] }) => Promise<T[]>;
};

export const clackPicker: Picker = {
  // clack draws on stdout, so with only stdin checked a piped run would draw the prompt into the pipe.
  isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,

  pick: async ({ message, choices }) => {
    const selection = await multiselect({
      message,
      options: choices.map(({ label, hint }, index) => ({ value: index, label, hint })),
      required: false,
    });

    if (isCancel(selection)) {
      return [];
    }

    const chosen = new Set(selection);
    return choices.filter((_, index) => chosen.has(index)).map((choice) => choice.value);
  },
};
