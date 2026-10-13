export type TextStyle = 'bold' | 'dim' | 'cyan' | 'yellow' | 'red' | 'green';

/** Applies a format to text, or returns it unchanged when color doesn't apply. */
export type TextStyler = (style: TextStyle, text: string) => string;
