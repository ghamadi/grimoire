/**
 * Content identity: whether two copies of a skill agree.
 *
 * The ignore list is bound once at construction rather than taken per call, so
 * an asymmetric comparison has no spelling — a caller cannot hash one side with
 * the list and the other without. The same instance's matcher is what the copy
 * engine takes, so what a copy declines to write and what the hash skips can
 * never disagree.
 */
export { createTreeHasher, type TreeHasher } from './hasher.ts';
