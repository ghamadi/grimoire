import { GrimoireError } from '@/lib/errors/grimoire-error';

export type NoTerminalErrorProps = {
  location: string;
  skillCount: number;
};

/**
 * Used when `skills add` needs a selection, `--all` was not given, and nothing is
 * attached that could answer a prompt.
 */
export class NoTerminalError extends GrimoireError {
  readonly location: string;
  readonly skillCount: number;

  constructor(props: NoTerminalErrorProps) {
    const { location, skillCount } = props;
    super(
      [
        `${location} holds ${skillCount} skill${skillCount === 1 ? '' : 's'} and no terminal to choose from`,
        '  use --all to add every one',
      ].join('\n'),
    );

    this.name = 'NoTerminalError';
    this.location = location;
    this.skillCount = skillCount;
  }
}
