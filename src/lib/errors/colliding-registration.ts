import type { Collision } from '#src/domains/grimoire-store/index';
import { normalizePath } from '#src/lib/paths';
import { GrimoireError } from './grimoire-error.ts';
import { describeCollision } from './path-collision.ts';

export type CollidingRegistrationErrorProps = {
  name: string;
  path: string;
  collision: Collision;
  /** Where the registration is recorded, which is the only place it can be undone. */
  storeState: string;
};

/**
 * A registered path touches the store, which `add` refuses to create — so the
 * entry arrived by hand-editing `state.json`.
 *
 * Raised when the registry is read rather than when the path is used, so it
 * stops every command rather than the ones that would write through the path.
 * That is the whole point: the store manager never hands out a registry it knows
 * to be illegal, so no command has to remember to ask.
 *
 * The message names `state.json` because no command repairs one yet. Editing it
 * by hand is the same way the entry got there, and the eventual `doctor` is what
 * replaces that instruction.
 */
export class CollidingRegistrationError extends GrimoireError {
  readonly entryName: string;
  readonly path: string;
  readonly collision: Collision;

  constructor(props: CollidingRegistrationErrorProps) {
    const { name, path, collision, storeState } = props;
    super(
      [
        `workspace "${name}" cannot be used: ${describeCollision({ path, collision })}`,
        `  no command can run until it is gone from ${normalizePath(storeState)}`,
      ].join('\n'),
    );

    this.name = 'CollidingRegistrationError';
    this.entryName = name;
    this.path = normalizePath(path);
    this.collision = { ...collision, path: normalizePath(collision.path) };
  }
}
