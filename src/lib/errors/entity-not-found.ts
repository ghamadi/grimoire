import { GrimoireError } from './grimoire-error.ts';

export type Entity = 'workspace' | 'skill';

export type EntityNotFoundErrorProps = {
  entity: Entity;
  name: string;
};

/** A named entity the caller asked for is not registered. */
export class EntityNotFoundError extends GrimoireError {
  readonly entity: Entity;
  readonly entryName: string;

  constructor(props: EntityNotFoundErrorProps) {
    const { entity, name } = props;
    super(`no ${entity} named "${name}"`);

    this.name = 'EntityNotFoundError';
    this.entity = entity;
    this.entryName = name;
  }
}
