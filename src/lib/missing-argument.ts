/**
 * Commander's wording. `listFlag` is a list flag that took names: commander
 * gives it every word after it, so an argument typed after it is never seen.
 */
export function formatMissingArgument(params: {
  name: string;
  allFlag?: string;
  listFlag?: string;
}): string {
  const { name, allFlag, listFlag } = params;

  const headline = `error: missing required argument '${name}'${allFlag ? ` (or use ${allFlag})` : ''}`;

  return listFlag
    ? `${headline}\n  ${listFlag} takes every name after it, so name the ${name} before it`
    : headline;
}
