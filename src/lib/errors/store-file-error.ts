import { GrimoireError } from './grimoire-error.ts';

export type StoreFileErrorProps = {
  file: string;
  reason: 'invalid-json' | 'invalid-shape';
  detail: string;
  cause?: unknown;
};

/**
 * A store file on disk could not be read as the shape it is supposed to hold.
 *
 * The message always leads with the absolute path, because the fix is always
 * "go edit that file".
 */
export class StoreFileError extends GrimoireError {
  readonly file: string;
  readonly reason: 'invalid-json' | 'invalid-shape';

  constructor(props: StoreFileErrorProps) {
    const { file, reason, detail, cause } = props;
    super(`${file}: ${detail}`, cause !== undefined ? { cause } : undefined);

    this.name = 'StoreFileError';
    this.file = file;
    this.reason = reason;
  }
}
