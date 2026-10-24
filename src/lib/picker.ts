import { isCancel, multiselect } from '@clack/prompts';
import { MissingDestinationError } from '@/lib/errors';

export type PickerChoice<T> = { value: T; label: string; hint?: string };

export type Picker = {
  isInteractive: () => boolean;
  /** [] when nothing is chosen or the prompt is cancelled. */
  pick: <T>(params: { message: string; choices: PickerChoice<T>[] }) => Promise<T[]>;
};

export type PickChoicesResult<T> =
  { kind: 'picked'; values: T[] } | { kind: 'no-choices' } | { kind: 'none-picked' };

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

export async function pickChoices<T>(params: {
  picker: Picker;
  message: string;
  choices: PickerChoice<T>[];
  refusal: { noun: string; remedy: string };
}): Promise<PickChoicesResult<T>> {
  const { picker, message, choices, refusal } = params;

  if (!picker.isInteractive()) {
    throw new MissingDestinationError({
      ...refusal,
      choiceLabels: choices.map((choice) => choice.label),
    });
  }

  if (choices.length === 0) {
    return { kind: 'no-choices' };
  }

  const picked = new Set(await picker.pick({ message, choices }));
  if (picked.size === 0) {
    return { kind: 'none-picked' };
  }

  const values = choices.map((choice) => choice.value).filter((value) => picked.has(value));
  return { kind: 'picked', values };
}
