import type { Picker } from '@/lib/picker';

/** Picks by label: `choose` returns labels, not values. */
export function fakePicker(params: {
  choose: (labels: string[]) => string[];
  isInteractive?: boolean;
}): Picker & { offered: string[] } {
  const { choose, isInteractive = true } = params;
  const offered: string[] = [];

  return {
    offered,
    isInteractive: () => isInteractive,
    pick: ({ choices }) => {
      const labels = choices.map((choice) => choice.label);
      offered.push(...labels);

      return Promise.resolve(
        choose(labels).flatMap((label) =>
          choices.filter((choice) => choice.label === label).map((choice) => choice.value),
        ),
      );
    },
  };
}
