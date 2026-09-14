import { GrimoireError } from './grimoire-error.ts';

export type DuplicateNameErrorProps = {
  name: string;
};

/**
 * A name being registered is already taken.
 *
 * The offending name is `entryName`, not `name`: `Error.name` is the class
 * name, and every subclass here sets it.
 */
export class DuplicateNameError extends GrimoireError {
  readonly entryName: string;

  constructor(props: DuplicateNameErrorProps) {
    const { name } = props;
    super(`workspace "${name}" is already registered`);

    this.name = 'DuplicateNameError';
    this.entryName = name;
  }
}
