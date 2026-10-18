import type { GrimoireStoreManager } from '@/domains/grimoire-store';
import { Workspace } from '@/domains/workspace';

type AddWorkspaceUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

type AddWorkspaceUseCaseParams = {
  name: string;
  path: string;
  autoLink?: boolean;
};

type AddWorkspaceResult = {
  workspace: Workspace;
  /** The directory was made by this registration rather than found. */
  created: boolean;
};

type AddWorkspaceUseCase = (params: AddWorkspaceUseCaseParams) => AddWorkspaceResult;

/**
 * Registers a workspace in the grimoire store — what `grimoire workspaces add` runs.
 *
 * `autoLink` is recorded and nothing else: it names where a skill goes when it
 * enters the store, so registering a workspace links nothing into it, not even
 * the skills the store already holds.
 */
export function createAddWorkspaceUseCase(
  factoryParams: AddWorkspaceUseCaseFactoryParams,
): AddWorkspaceUseCase {
  const { storeManager } = factoryParams;

  return (params: AddWorkspaceUseCaseParams) => {
    const { name, autoLink = false } = params;

    // The registration is what vets and normalizes the path, so the entity is
    // built from what came back rather than from what was typed.
    const { path, created } = storeManager.registerWorkspace({ name, path: params.path, autoLink });

    return { workspace: new Workspace({ name, path, autoLink }), created };
  };
}
