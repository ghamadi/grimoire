/**
 * Discovery: what skills a directory holds.
 *
 * The module reads the filesystem and nothing else — no config, no store
 * handle. A repo, a workspace and a directory someone sent you are all just a
 * path here, which is what lets every content command resolve names the same
 * way.
 */
export { scanSkills, type ScannedSkill } from './scanner.ts';
