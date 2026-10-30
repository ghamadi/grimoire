import { describeSentences } from '@/lib/errors/clone-sentences';
import { GrimoireError } from '@/lib/errors/grimoire-error';

export type PackRefusal =
  | { kind: 'holds-symlink'; skill: string; zipPath: string; entry: string }
  | { kind: 'occupied'; skill: string; zipPath: string };

export function describePackRefusal(refusal: PackRefusal): string {
  const reason =
    refusal.kind === 'holds-symlink'
      ? `the skill holds the symlink "${refusal.entry}"`
      : 'something is already there — delete it to pack again';

  return `could not pack ${refusal.skill} → ${refusal.zipPath}: ${reason}`;
}

export type PackDeclinedErrorProps = {
  refusals: PackRefusal[];
};

export class PackDeclinedError extends GrimoireError {
  readonly refusals: PackRefusal[];

  constructor(props: PackDeclinedErrorProps) {
    super(
      describeSentences({
        header: 'nothing packed:',
        sentences: props.refusals.map(describePackRefusal),
      }),
    );

    this.name = 'PackDeclinedError';
    this.refusals = props.refusals;
  }
}
