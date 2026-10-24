import { GrimoireError } from '@/lib/errors/grimoire-error';
import { formatShellCommand } from '@/lib/shell-command';

export type MissingDestinationErrorProps = {
  noun: string;
  remedy: string;
  choiceLabels: string[];
};

export class MissingDestinationError extends GrimoireError {
  readonly noun: string;
  readonly remedy: string;
  readonly choiceLabels: string[];

  constructor(props: MissingDestinationErrorProps) {
    const { noun, remedy, choiceLabels } = props;
    super(
      [
        `no ${noun} named, and no terminal to choose from`,
        choiceLabels.length > 0 ? `  ${remedy}: ${formatShellCommand(choiceLabels)}` : `  ${remedy}`,
      ].join('\n'),
    );

    this.name = 'MissingDestinationError';
    this.noun = noun;
    this.remedy = remedy;
    this.choiceLabels = choiceLabels;
  }
}
