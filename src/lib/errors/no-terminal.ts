import { GrimoireError } from '@/lib/errors/grimoire-error';

export type NoTerminalErrorProps = {
  location: string;
};

/**
 * Used when `skills add` needs a selection, `--all` was not given, and nothing is
 * attached that could answer a prompt.
 */
export class NoTerminalError extends GrimoireError {
  readonly location: string;

  constructor(props: NoTerminalErrorProps) {
    const { location } = props;
    super([`no terminal to choose skills from ${location}`, '  use --all to add every one'].join('\n'));

    this.name = 'NoTerminalError';
    this.location = location;
  }
}
