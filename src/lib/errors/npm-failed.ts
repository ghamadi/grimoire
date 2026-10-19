import { GrimoireError } from '@/lib/errors/grimoire-error';
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
    const stderrLines = stderr
      .trim()
      .split('\n')
      .filter((line) => line.trim() !== '');

    super(
      [
        `\`${formatShellCommand(['npm', ...args])}\` failed:`,
        ...stderrLines.map((line) => `  ${line}`),
      ].join('\n'),
    );

    this.name = 'NpmFailedError';
    this.args = args;
    this.stderr = stderr;
  }
}
