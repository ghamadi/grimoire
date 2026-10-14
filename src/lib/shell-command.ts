/** `words` as one line that a POSIX shell reads back as exactly those words. */
export function formatShellCommand(words: string[]): string {
  return words.map(formatShellWord).join(' ');
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function formatShellWord(word: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
