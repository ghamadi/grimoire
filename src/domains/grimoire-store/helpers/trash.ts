import { createHash } from 'node:crypto';
import { sep } from 'node:path';
import type { CloneRecord } from '#src/domains/grimoire-store/value-objects/store-state';

const MAX_LABEL_LENGTH = 200;
const HASH_LENGTH = 8;

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

/**
 * What a clone is called inside its bin: a workspace's name, or a recorded path
 * turned into one directory name.
 *
 * Only separators are rewritten. A slug past 200 characters is cut there and
 * given a hash of the full path, so two paths agreeing that far stay apart.
 */
export function cloneTrashLabel(record: CloneRecord): string {
  if ('workspace' in record) {
    return record.workspace;
  }

  const slug = record.path
    .split(sep)
    .filter((segment) => segment !== '')
    .join('-');

  if (slug.length <= MAX_LABEL_LENGTH) {
    return slug;
  }

  const hash = createHash('sha256').update(record.path).digest('hex').slice(0, HASH_LENGTH);

  return `${slug.slice(0, MAX_LABEL_LENGTH)}-${hash}`;
}
