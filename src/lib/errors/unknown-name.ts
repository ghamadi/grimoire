import { registryNoun, type Registry } from '#src/lib/registry';
import { GrimoireError } from './grimoire-error.ts';

export type UnknownNameErrorProps = {
  registry: Registry;
  name: string;
};

/** A name a command was asked to act on is not registered. */
export class UnknownNameError extends GrimoireError {
  readonly registry: Registry;
  readonly entryName: string;

  constructor(props: UnknownNameErrorProps) {
    const { registry, name } = props;
    super(`no ${registryNoun(registry)} named "${name}"`);

    this.name = 'UnknownNameError';
    this.registry = registry;
    this.entryName = name;
  }
}
