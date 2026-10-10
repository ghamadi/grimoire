import { describeSentences } from './clone-sentences.ts';
import { GrimoireError } from './grimoire-error.ts';

/**
 * One skill `export` stepped over: a fact about the repo, not a mistake in
 * argv. The batch carries on past every one of them.
 */
export type ExportRefusal = {
  skill: string;
  repo: string;
  /** `<dest>` — `<repo path>/<skill>`. */
  path: string;
};

/**
 * `could not export <skill> → <repo>: …` — no `warning: ` or `error: ` prefix.
 *
 * A run that exported something prints these as warnings and returns; a run
 * that exported nothing throws them as one error. Both have to read
 * identically, or the same fact arrives in two voices.
 */
export function describeExportRefusal(refusal: ExportRefusal): string {
  return `could not export ${refusal.skill} → ${refusal.repo}: ${refusal.path} has uncommitted changes`;
}

export type ExportDeclinedErrorProps = {
  refusals: ExportRefusal[];
};

const FORCE_HINT = '  commit first, or use --force to overwrite them';

/**
 * An `export` run that declined every skill it was asked to export.
 *
 * The `--force` line belongs to the error and not to
 * {@link describeExportRefusal}: the same sentence printed as a warning beside
 * a success carries no hint.
 */
export class ExportDeclinedError extends GrimoireError {
  readonly refusals: ExportRefusal[];

  constructor(props: ExportDeclinedErrorProps) {
    const sentences = describeSentences({
      header: 'nothing exported:',
      sentences: props.refusals.map(describeExportRefusal),
    });

    super(`${sentences}\n${FORCE_HINT}`);

    this.name = 'ExportDeclinedError';
    this.refusals = props.refusals;
  }
}
