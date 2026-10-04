/** One sentence stands alone; a list needs the line saying what they add up to. */
export function describeSentences(params: { header: string; sentences: string[] }): string {
  const { header, sentences } = params;
  const [only] = sentences;

  if (only !== undefined && sentences.length === 1) {
    return only;
  }

  return [header, ...sentences.map((sentence) => `  ${sentence}`)].join('\n');
}
