import { existsSync } from 'node:fs';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { Skill, type SkillSource } from '@/domains/skill';
import { compareContainment } from '@/lib/directory-containment';
import { AddDeclinedError, type AddRefusal, UnportableSkillError } from '@/lib/errors';
import { isSystemError } from '@/lib/fs';

// ----------------------------------------------------------------------------
// RESULT SHAPES
// ----------------------------------------------------------------------------

type AddSkillsUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

export type AddSkillsUseCaseParams = {
  /** Already selected. Verified and copied in the order given. */
  sources: SkillSource[];
};

export type SkillAdded = { skill: string; storePath: string };

export type SkillPresent = {
  skill: string;
  /** The first entry the store copy holds and the source does not, when there is one. */
  storeExtra?: string;
};

export type AddSkillsReport = {
  added: SkillAdded[];
  present: SkillPresent[];
  declined: AddRefusal[];
};

export type AddSkillsUseCase = (params: AddSkillsUseCaseParams) => AddSkillsReport;

// ----------------------------------------------------------------------------
// THE USE CASE
// ----------------------------------------------------------------------------

/**
 * Copies verified sources into the store, classifying each collision.
 *
 * A source is verified as it is reached rather than all up front: a crawl
 * result is not a name the user typed, so one bad directory among twelve
 * costs that directory rather than the run. A run that declined every source
 * throws rather than returning an empty report, so it exits like every other
 * refusal.
 */
export function createAddSkillsUseCase(factoryParams: AddSkillsUseCaseFactoryParams): AddSkillsUseCase {
  const { storeManager } = factoryParams;

  return (params: AddSkillsUseCaseParams) => {
    const added: SkillAdded[] = [];
    const present: SkillPresent[] = [];
    const declined: AddRefusal[] = [];

    for (const source of params.sources) {
      const outcome = decideForSource({ source, storeManager });

      switch (outcome.kind) {
        case 'added':
          added.push({ skill: source.name, storePath: outcome.storePath });
          break;
        case 'present':
          present.push({ skill: source.name, storeExtra: outcome.storeExtra });
          break;
        case 'declined':
          declined.push(outcome.refusal);
          break;
      }
    }

    if (declined.length > 0 && added.length === 0 && present.length === 0) {
      throw new AddDeclinedError({ refusals: declined });
    }

    return { added, present, declined };
  };
}

// ----------------------------------------------------------------------------
// THE PER-SOURCE ENGINE
// ----------------------------------------------------------------------------

type SourceOutcome =
  | { kind: 'added'; storePath: string }
  | { kind: 'present'; storeExtra?: string }
  | { kind: 'declined'; refusal: AddRefusal };

/**
 * Verifies and, depending on what the store already holds under that name,
 * copies or classifies one source.
 */
function decideForSource(params: {
  source: SkillSource;
  storeManager: GrimoireStoreManager;
}): SourceOutcome {
  const { source, storeManager } = params;

  try {
    Skill.createVerified(source);
  } catch (error) {
    if (error instanceof UnportableSkillError) {
      return {
        kind: 'declined',
        refusal: {
          kind: 'unportable',
          skill: source.name,
          location: source.location,
          reason: error.reason,
        },
      };
    }

    if (isSystemError(error)) {
      return {
        kind: 'declined',
        refusal: { kind: 'system-failure', skill: source.name, error },
      };
    }

    throw error;
  }

  const storePath = storeManager.skillPath(source.name);

  // If the skill is not already in the store, add it.
  if (!existsSync(storePath)) {
    return {
      kind: 'added',
      storePath: storeManager.addSkill({ name: source.name, sourcePath: source.path }),
    };
  }

  // Containment, not equality: the source is the tree that has to be accounted
  // for, and a store copy holding more than the source still holds every byte
  // of what is being added. Comparing both ways instead would refuse the add
  // over entries nobody asked to import.
  const sourceInStore = compareContainment({ candidate: source.path, reference: storePath });

  switch (sourceInStore.kind) {
    case 'contained':
      return { kind: 'present', storeExtra: findStoreExtra({ storePath, sourcePath: source.path }) };

    case 'differs':
      return {
        kind: 'declined',
        refusal: { kind: 'differs', skill: source.name, storePath, entry: sourceInStore.entry },
      };

    case 'unportable':
      return {
        kind: 'declined',
        refusal: {
          kind: 'incomparable',
          skill: source.name,
          root: sourceInStore.root === source.path ? source.location : sourceInStore.root,
          entry: sourceInStore.entry,
        },
      };
  }
}

/**
 * The first entry the store copy holds and the source does not, or `undefined`
 * when the two hold the same tree.
 *
 * Called only once the source is known contained, so every shared entry is
 * already proven identical and the reverse walk can fail on nothing but an
 * entry the store alone holds — a symlink among them, which is still an extra
 * rather than a comparison this add has any reason to refuse.
 */
function findStoreExtra(params: { storePath: string; sourcePath: string }): string | undefined {
  const storeInSource = compareContainment({
    candidate: params.storePath,
    reference: params.sourcePath,
  });

  return storeInSource.kind === 'contained' ? undefined : storeInSource.entry;
}
