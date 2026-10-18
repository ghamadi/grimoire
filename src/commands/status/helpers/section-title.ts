import type { TextStyle, TextStyler } from '@/lib/text-styler';

/** A section's first line: the bold title, two spaces, the caption. */
export function formatSectionTitle(params: {
  title: string;
  caption: string;
  captionStyle: TextStyle;
  textStyler: TextStyler;
}): string {
  const { title, caption, captionStyle, textStyler } = params;

  return `${textStyler('bold', title)}  ${textStyler(captionStyle, caption)}`;
}
