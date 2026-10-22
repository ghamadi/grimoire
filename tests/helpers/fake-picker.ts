import type { Picker } from '@/lib/picker';

/** Picks by label: `choose` returns labels, not values. */
export function fakePicker(params: {
  choose: (labels: string[]) => string[];
  isInteractive?: boolean;
}): Picker & { offered: string[]; offeredHints: (string | undefined)[] } {
  const { choose, isInteractive = true } = params;
  const offered: string[] = [];
  const offeredHints: (string | undefined)[] = [];

  return {
    offered,
    offeredHints,
    isInteractive: () => isInteractive,
    pick: ({ choices }) => {
      const labels = choices.map((choice) => choice.label);
      offered.push(...labels);
      offeredHints.push(...choices.map((choice) => choice.hint));

      return Promise.resolve(
        choose(labels).flatMap((label) =>
          choices.filter((choice) => choice.label === label).map((choice) => choice.value),
        ),
      );
    },
  };
}
