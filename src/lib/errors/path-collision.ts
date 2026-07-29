import type { Collision, Relation } from '#src/lib/paths';
import { registryNoun } from '#src/lib/registry';
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
    const { path, collision } = props;
    super(`${path} ${describeRelation(collision.relation)} ${describeTarget(collision)}`);

    this.name = 'PathCollisionError';
    this.path = path;
    this.collision = collision;
  }
}

function describeRelation(relation: Relation): string {
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
  if (collision.kind === 'grimoire-home') {
    return `the grimoire store (${collision.path})`;
  }

  return `${registryNoun(collision.registry)} "${collision.name}" (${collision.path})`;
}
