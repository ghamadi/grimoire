import { registryNoun, type Registry } from '#src/lib/registry';
import { GrimoireError } from './grimoire-error.ts';

export type DuplicateNameErrorProps = {
  registry: Registry;
  name: string;
};

/**
 * A name being registered is already taken in its own registry.
 *
 * The offending name is `entryName`, not `name`: `Error.name` is the class
 * name, and every subclass here sets it.
 */
export class DuplicateNameError extends GrimoireError {
  readonly registry: Registry;
  readonly entryName: string;

  constructor(props: DuplicateNameErrorProps) {
    const { registry, name } = props;
    super(`${registryNoun(registry)} "${name}" is already registered`);

    this.name = 'DuplicateNameError';
    this.registry = registry;
    this.entryName = name;
  }
}
