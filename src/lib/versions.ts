/**
 * Orders two `major.minor.patch` versions like a sort comparator: negative when
 * `left` is older, zero when equal, positive when `left` is newer.
 *
 * @throws Error when either side is not a plain `major.minor.patch` version.
 */
export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  const differences = leftParts.map((leftPart, index) => leftPart - (rightParts[index] ?? 0));

  return differences.find((difference) => difference !== 0) ?? 0;
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function parseVersion(version: string): number[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`not a major.minor.patch version: "${version}"`);
  }

  return version.split('.').map(Number);
}
