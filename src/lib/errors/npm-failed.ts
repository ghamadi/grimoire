import { GrimoireError } from '@/lib/errors/grimoire-error';
import { formatIndentedLines } from '@/lib/errors/indented-lines';
import { formatShellCommand } from '@/lib/shell-command';

export type NpmFailedErrorProps = {
  args: string[];
  stderr: string;
};

export class NpmFailedError extends GrimoireError {
  readonly args: string[];
  readonly stderr: string;

  constructor(props: NpmFailedErrorProps) {
    const { args, stderr } = props;

    super(
      [`\`${formatShellCommand(['npm', ...args])}\` failed:`, ...formatIndentedLines(stderr)].join('\n'),
    );

    this.name = 'NpmFailedError';
    this.args = args;
    this.stderr = stderr;
  }
}
