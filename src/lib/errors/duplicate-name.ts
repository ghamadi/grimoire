import type { RegistryEntity } from '@/lib/errors/entity-not-found';
import { GrimoireError } from '@/lib/errors/grimoire-error';

export type DuplicateNameErrorProps = {
  entity: RegistryEntity;
  name: string;
};

/**
 * A name being registered is already taken.
 *
 * The offending name is `entryName`, not `name`: `Error.name` is the class
 * name, and every subclass here sets it.
 */
export class DuplicateNameError extends GrimoireError {
  readonly entity: RegistryEntity;
  readonly entryName: string;

  constructor(props: DuplicateNameErrorProps) {
    const { entity, name } = props;
    super(`${entity} "${name}" is already registered`);

    this.name = 'DuplicateNameError';
    this.entity = entity;
    this.entryName = name;
  }
}
