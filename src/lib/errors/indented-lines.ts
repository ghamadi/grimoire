/** Each non-blank line of `text`, indented two spaces to sit under an error's first line. */
export function formatIndentedLines(text: string): string[] {
  return text
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => `  ${line}`);
}
