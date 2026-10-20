import { describe, expect, it } from 'vitest';
import { formatShellCommand } from '@/lib/shell-command';
import { getShellWords } from '@test-helpers/shell-words';

const charactersNeedingQuotes = [
  ' ',
  '\t',
  '\n',
  '$',
  '`',
  '"',
  "'",
  '\\',
  '!',
  '*',
  '?',
  '[',
  ']',
  '{',
  '}',
  '(',
  ')',
  '<',
  '>',
  '|',
  '&',
  ';',
  '#',
  '~',
  '=',
  '%',
  '@',
  '+',
  ':',
  ',',
  'é',
];

describe('formatShellCommand', () => {
  it('joins words that need no quoting with single spaces', () => {
    expect(
      formatShellCommand(['grimoire', 'clone', 'notes', '--drop', '/Users/me/.claude/skills']),
    ).toBe('grimoire clone notes --drop /Users/me/.claude/skills');
  });

  it('single-quotes a word with a space', () => {
    expect(formatShellCommand(['clone', '/Users/me/My Projects'])).toBe("clone '/Users/me/My Projects'");
  });

  it('writes a single quote inside a word as a closed, escaped and reopened quote', () => {
    expect(formatShellCommand(["it's"])).toBe("'it'\\''s'");
  });

  it('prints an empty word as a pair of single quotes', () => {
    expect(formatShellCommand(['clone', ''])).toBe("clone ''");
  });

  it.each(charactersNeedingQuotes)('quotes a word containing %j', (character) => {
    const commandText = formatShellCommand([`a${character}b`]);

    expect(commandText.startsWith("'")).toBe(true);
    expect(commandText.endsWith("'")).toBe(true);
  });

  it('round-trips hostile words through /bin/sh', () => {
    const words = [
      ...charactersNeedingQuotes.map((character) => `a${character}b`),
      'a b$c`d"e\'f\\g!h*i',
      '$HOME',
      '$(echo pwned)',
      '`echo pwned`',
      'trailing\\',
      '',
    ];

    expect(getShellWords(formatShellCommand(words))).toEqual(words);
  });
});
