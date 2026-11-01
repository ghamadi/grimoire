import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import type { ConfirmPrompt } from '@/lib/confirm-prompt';
import type { Picker } from '@/lib/picker';

export async function confirmOverwrite(params: {
  skillNames: string[];
  picker: Picker;
  confirmPrompt: ConfirmPrompt;
}): Promise<boolean> {
  const { skillNames, picker, confirmPrompt } = params;

  return (
    picker.isInteractive() &&
    confirmPrompt({
      message: `Replace the store copy of ${skillNames.join(', ')}? Skill directories get replaced completely, not merged. Each old copy goes to the trash.`,
    })
  );
}

/** Logs each replacement as it lands, so a later failure can't hide a bin already made. */
export function overwriteSkills(params: {
  skillNames: string[];
  sourcePathsByName: Map<string, string>;
  storeManager: GrimoireStoreManager;
  now: () => Date;
}): void {
  const { skillNames, sourcePathsByName, storeManager, now } = params;
  const at = now();

  for (const name of skillNames) {
    const sourcePath = sourcePathsByName.get(name);

    if (sourcePath === undefined) {
      throw new Error(`no source path for skill "${name}"`);
    }

    const binPath = storeManager.replaceSkill({ name, sourcePath, at });

    console.log(`replaced ${name} (old copy: ${binPath})`);
  }
}
