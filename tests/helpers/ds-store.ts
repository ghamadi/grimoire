export const DS_STORE_NAME = '.DS_Store';

/**
 * The bytes of a `.DS_Store` as Finder writes it: the 8-byte header, then
 * `padding`. Pass different paddings to get two Finder-shaped files whose bytes
 * disagree.
 *
 * The header is spelled out here rather than imported from `junk-files`, so the
 * tests do not assert the module's constant against itself.
 */
export function finderDsStoreBytes(params: { padding?: string } = {}): Buffer {
  const { padding = 'padding' } = params;

  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31]), Buffer.from(padding)]);
}
