export function formatIndentedLines(text: string): string[] {
  return text
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => `  ${line}`);
}
