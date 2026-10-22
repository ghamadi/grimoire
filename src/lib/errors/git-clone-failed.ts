import { GrimoireError } from '@/lib/errors/grimoire-error';
import { formatIndentedLines } from '@/lib/errors/indented-lines';

export type GitCloneFailedErrorProps = {
  url: string;
  reason: string;
};

export class GitCloneFailedError extends GrimoireError {
  readonly url: string;
  readonly reason: string;

  constructor(props: GitCloneFailedErrorProps) {
    const { url, reason } = props;

    super([`could not clone ${url}:`, ...formatIndentedLines(reason)].join('\n'));

    this.name = 'GitCloneFailedError';
    this.url = url;
    this.reason = reason;
  }
}
