import type { GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { Workspace } from '#src/domains/workspace/index';

type ListWorkspacesUseCaseFactoryParams = {
  storeManager: GrimoireStoreManager;
};

type ListWorkspacesUseCase = () => Workspace[];

/**
 * Every workspace the store has registered — what `grimoire workspace list` runs.
 *
 * The registry is the whole answer: the entities come back unverified, so a
 * workspace whose directory was deleted or has come to sit inside the store is
 * still listed. Filtering those out would leave the user with no way to see the
 * registration they have to remove, and reporting on them is `status`'s job.
 */
export function createListWorkspacesUseCase(
  factoryParams: ListWorkspacesUseCaseFactoryParams,
): ListWorkspacesUseCase {
  const { storeManager } = factoryParams;

  return () => storeManager.listRegisteredWorkspaces().map((entry) => new Workspace(entry));
}
