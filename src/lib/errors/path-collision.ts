import type { Collision } from '#src/domains/grimoire-store/index';
import { normalizePath, type PathRelation } from '#src/lib/paths';
import { GrimoireError } from './grimoire-error.ts';

export type PathCollisionErrorProps = {
  path: string;
  collision: Collision;
};

/**
 * A path would break the rule that no registered path may equal, contain, or
 * sit inside a path in the other registry, or touch `~/.grimoire/`.
 *
 * The whole point of the class is the message: which entry, at what path, in
 * which direction. The `collision` survives on the instance so a structured
 * output mode can render the same facts differently.
 */
export class PathCollisionError extends GrimoireError {
  readonly path: string;
  readonly collision: Collision;

  constructor(props: PathCollisionErrorProps) {
    super(describeCollision(props));

    this.name = 'PathCollisionError';
    this.path = normalizePath(props.path);
    this.collision = { ...props.collision, path: normalizePath(props.collision.path) };
  }
}

/**
 * The sentence, without the refusal.
 *
 * The same fact reaches the user from two places — refused at registration, and
 * refused again when the registry is read — so the sentence lives here rather
 * than in either error, or it arrives in two voices.
 */
export function describeCollision(props: PathCollisionErrorProps): string {
  const { path, collision } = props;

  return `${normalizePath(path)} ${describeRelation(collision.relation)} ${describeTarget(collision)}`;
}

function describeRelation(relation: PathRelation): string {
  switch (relation) {
    case 'equals':
      return 'is the same directory as';
    case 'inside':
      return 'sits inside';
    case 'contains':
      return 'contains';
  }
}

function describeTarget(collision: Collision): string {
  return `the grimoire store (${normalizePath(collision.path)})`;
}
