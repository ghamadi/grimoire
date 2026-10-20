import { normalizePath } from '@/lib/paths';
import type { RegistryEntity } from '@/lib/errors/entity-not-found';
import { GrimoireError } from '@/lib/errors/grimoire-error';
import { describeCollision, type Collision } from '@/lib/errors/path-collision';

export type CollidingRegistrationErrorProps = {
  entity: RegistryEntity;
  name: string;
  path: string;
  collision: Collision;
  /** Where the registration is recorded, which is the only place it can be undone. */
  storeState: string;
};

/**
 * A registered path touches the store or a path in the other registry, which
 * registration refuses to create — so it got there by hand-editing `state.json`,
 * or by a symlink repointed after registration.
 *
 * Raised when the registry is read rather than when the path is used, so it
 * stops every command rather than the ones that would write through the path.
 * That is the whole point: the store manager never hands out a registry it knows
 * to be illegal, so no command has to remember to ask.
 *
 * The message names `state.json` because no command repairs one yet. The
 * eventual `doctor` is what replaces that instruction.
 */
export class CollidingRegistrationError extends GrimoireError {
  readonly entity: RegistryEntity;
  readonly entryName: string;
  readonly path: string;
  readonly collision: Collision;

  constructor(props: CollidingRegistrationErrorProps) {
    const { entity, name, path, collision, storeState } = props;
    const subject = collision.kind === 'grimoire-home' ? 'it is' : 'one of them is';
    super(
      [
        `${entity} "${name}" cannot be used: ${describeCollision({ path, collision })}`,
        `  no command can run until ${subject} gone from ${normalizePath(storeState)}`,
      ].join('\n'),
    );

    this.name = 'CollidingRegistrationError';
    this.entity = entity;
    this.entryName = name;
    this.path = normalizePath(path);
    this.collision = { ...collision, path: normalizePath(collision.path) };
  }
}
