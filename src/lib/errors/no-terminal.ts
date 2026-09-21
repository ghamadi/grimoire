import { GrimoireError } from './grimoire-error.ts';

export type NoTerminalErrorProps = {
  path: string;
  skillCount: number;
};

/**
 * Used when `skills add` needs a selection, `--all` was not given, and nothing is
 * attached that could answer a prompt.
 */
export class NoTerminalError extends GrimoireError {
  readonly path: string;
  readonly skillCount: number;

  constructor(props: NoTerminalErrorProps) {
    const { path, skillCount } = props;
    super(
      [
        `${path} holds ${skillCount} skill${skillCount === 1 ? '' : 's'} and no terminal to choose from`,
        '  use --all to add every one',
      ].join('\n'),
    );

    this.name = 'NoTerminalError';
    this.path = path;
    this.skillCount = skillCount;
  }
}
