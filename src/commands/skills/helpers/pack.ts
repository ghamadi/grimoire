import { lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { Skill } from '@/domains/skill';
import { assertUsableDirectory } from '@/lib/directories';
import {
  PackDeclinedError,
  PackFailedError,
  describePackRefusal,
  type PackFailure,
  type PackRefusal,
} from '@/lib/errors';
import { STAGING_DIRECTORY_NAME, writeFileStaged } from '@/lib/fs';
import { normalizePath } from '@/lib/paths';
import type { Picker } from '@/lib/picker';
import { zipDirectory } from '@/lib/zip';

type PackOutcome =
  | { kind: 'packed'; skill: string; zipPath: string }
  | { kind: 'declined'; refusal: PackRefusal }
  | { kind: 'failed'; failure: PackFailure };

// ----------------------------------------------------------------------------
// THE ACTION
// ----------------------------------------------------------------------------

export function packSkills(params: {
  storeManager: GrimoireStoreManager;
  skillNames: string[];
  outPath: string;
}): void {
  const { storeManager, skillNames, outPath } = params;

  const skills = requirePackableSkills({ storeManager, skillNames });
  const outDirectory = normalizePath(outPath);

  assertUsableDirectory(outDirectory);
  storeManager.assertNotInsideStore(outDirectory);

  report(skills.map((skill) => packSkill({ skill, outDirectory })));
}

export async function pickSkillNames(params: {
  picker: Picker;
  skillNames: string[];
}): Promise<string[]> {
  const { picker, skillNames } = params;

  const picked = new Set(
    await picker.pick({
      message: 'Select the skills to pack',
      choices: skillNames.map((name) => ({ value: name, label: name })),
    }),
  );

  return skillNames.filter((name) => picked.has(name));
}

// ----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// ----------------------------------------------------------------------------

/** Two passes, so an unknown skill named after an unportable one is reported as unknown. */
function requirePackableSkills(params: {
  storeManager: GrimoireStoreManager;
  skillNames: string[];
}): Skill[] {
  const { storeManager, skillNames } = params;

  return [...new Set(skillNames)]
    .map((name) => ({
      name,
      path: storeManager.requireSkillPath(name, { requireSkillDirectory: true }),
    }))
    .map((skill) => Skill.createVerified(skill));
}

function packSkill(params: { skill: Skill; outDirectory: string }): PackOutcome {
  const { skill, outDirectory } = params;
  const zipPath = join(outDirectory, `${skill.name}.zip`);

  const symlink = skill.flattenedTree.find((entry) => lstatSync(entry).isSymbolicLink());

  if (symlink) {
    return {
      kind: 'declined',
      refusal: {
        kind: 'holds-symlink',
        skill: skill.name,
        zipPath,
        entry: relative(skill.path, symlink),
      },
    };
  }

  if (lstatSync(zipPath, { throwIfNoEntry: false })) {
    return { kind: 'declined', refusal: { kind: 'occupied', skill: skill.name, zipPath } };
  }

  const result = writeFileStaged({
    getContents: () => zipDirectory({ directory: skill.path, rootName: skill.name }),
    to: zipPath,
    stagingDirectory: join(outDirectory, STAGING_DIRECTORY_NAME),
  });

  return result.kind === 'written'
    ? { kind: 'packed', skill: skill.name, zipPath }
    : { kind: 'failed', failure: { skill: skill.name, zipPath, error: result.error } };
}

function report(outcomes: PackOutcome[]): void {
  const packed = outcomes.flatMap((outcome) => (outcome.kind === 'packed' ? [outcome] : []));
  const refusals = outcomes.flatMap((outcome) => (outcome.kind === 'declined' ? [outcome.refusal] : []));
  const failures = outcomes.flatMap((outcome) => (outcome.kind === 'failed' ? [outcome.failure] : []));

  if (refusals.length === outcomes.length) {
    throw new PackDeclinedError({ refusals });
  }

  for (const { skill, zipPath } of packed) {
    console.log(`packed ${skill} → ${zipPath}`);
  }

  for (const refusal of refusals) {
    console.warn(`warning: ${describePackRefusal(refusal)}`);
  }

  if (failures.length > 0) {
    throw new PackFailedError({ failures });
  }
}
