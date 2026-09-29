/**
 * `<skill>-YYYYMMDDTHHMMSS` in local time, the bin a removal moves into.
 *
 * Local rather than `toISOString()`'s UTC: the name exists to be matched against
 * the moment the person ran the command.
 */
export function trashBinName(params: { skill: string; at: Date }): string {
  const { skill, at } = params;
  const pad = (value: number): string => String(value).padStart(2, '0');

  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;

  return `${skill}-${date}T${time}`;
}
