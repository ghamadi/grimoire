/**
 * The repo domain: what registering, unregistering, and listing a repo *mean*.
 *
 * Nothing here imports commander or writes to stdout. Operations return data
 * and throw typed errors; deciding that a warning goes to stderr with a
 * `warning:` prefix is the command layer's job.
 */
export {
  DEFAULT_REPO_MODE,
  addRepo,
  listRepos,
  removeRepo,
  repoModes,
  type AddRepoInput,
  type Repo,
  type RepoAdded,
  type RepoMode,
  type RepoWarning,
} from './operations.ts';
