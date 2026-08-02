/**
 * The workspace domain: what registering, unregistering, and listing a
 * workspace *mean*.
 *
 * Nothing here imports commander or writes to stdout. Operations return data
 * and throw typed errors; deciding that a created directory is announced on
 * stdout is the command layer's job.
 *
 * `links.ts` is deliberately absent: `unlink` and `status` will want that scan
 * too, and the second caller is what decides where it belongs.
 */
export {
  addWorkspace,
  listWorkspaces,
  removeWorkspace,
  type AddWorkspaceInput,
  type RemoveWorkspaceInput,
  type Workspace,
  type WorkspaceAdded,
  type WorkspaceRemoved,
  type WorkspaceUsage,
} from './operations.ts';
