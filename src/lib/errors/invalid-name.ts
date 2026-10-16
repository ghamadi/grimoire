import type { RegistryEntity } from '@/lib/errors/entity-not-found';
import { GrimoireError } from '@/lib/errors/grimoire-error';

export const NAME_RULE_MESSAGE =
  'must start with a letter or digit and contain only letters, digits, "-" and "_"';

export type InvalidNameErrorProps = {
  entity: RegistryEntity;
  name: string;
};

/**
 * A workspace or repo name fails the registry's name rule.
 *
 * The offending name is `entryName`, not `name`: `Error.name` is the class
 * name, and every subclass here sets it.
 */
export class InvalidNameError extends GrimoireError {
  readonly entity: RegistryEntity;
  readonly entryName: string;

  constructor(props: InvalidNameErrorProps) {
    const { entity, name } = props;
    super(`${entity} name "${name}" ${NAME_RULE_MESSAGE}`);

    this.name = 'InvalidNameError';
    this.entity = entity;
    this.entryName = name;
  }
}
