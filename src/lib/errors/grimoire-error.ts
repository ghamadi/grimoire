/**
 * The base every expected, user-facing failure extends.
 *
 * `cli.ts` catches this and nothing else: an instance means the user did
 * something the CLI has a sentence for, and anything else is a bug that should
 * surface with its stack intact.
 *
 * Abstract on purpose — the discriminator itself carries no message shape, so
 * only a subclass that has decided how it reads can be thrown.
 */
export abstract class GrimoireError extends Error {}
