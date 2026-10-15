import { describe, expect, it } from 'vitest';
import type { TextStyler } from '@/lib/text-styler';
import { formatTable, type TableCell, type TableOverflow } from '@/lib/text-table';

const plainTextStyler: TextStyler = (_style, text) => text;
const taggingTextStyler: TextStyler = (style, text) => `<${style}>${text}</${style}>`;

const styledHeaders = ['NAME', 'MODE'];
const styledRows: TableCell[][] = [
  [{ text: 'personal', style: 'cyan' }, { text: 'auto' }],
  [{ text: 'team', style: 'green' }, { text: 'manual' }],
];

describe('formatTable', () => {
  it('draws a boxed table with a separator under the header only', () => {
    const lines = formatTable({
      headers: ['NAME', 'MODE'],
      rows: [[{ text: 'personal' }, { text: 'auto-link' }]],
      textStyler: plainTextStyler,
    });

    expect(lines).toEqual([
      '┌──────────┬───────────┐',
      '│ NAME     │ MODE      │',
      '├──────────┼───────────┤',
      '│ personal │ auto-link │',
      '└──────────┴───────────┘',
    ]);
  });

  it('sizes a column to the longer of its header and its longest cell', () => {
    const lines = formatTable({
      headers: ['WORKSPACE', 'ID'],
      rows: [
        [{ text: 'a' }, { text: '12345' }],
        [{ text: 'bb' }, { text: '1' }],
      ],
      textStyler: plainTextStyler,
    });

    expect(lines).toEqual([
      '┌───────────┬───────┐',
      '│ WORKSPACE │ ID    │',
      '├───────────┼───────┤',
      '│ a         │ 12345 │',
      '│ bb        │ 1     │',
      '└───────────┴───────┘',
    ]);
  });

  it('left-aligns every cell and pads it on the right', () => {
    const lines = formatTable({
      headers: ['A'],
      rows: [[{ text: 'long' }], [{ text: 'x' }]],
      textStyler: plainTextStyler,
    });

    expect(lines).toEqual(['┌──────┐', '│ A    │', '├──────┤', '│ long │', '│ x    │', '└──────┘']);
  });

  it('dims the borders, bolds the headers and never styles the padding around a cell', () => {
    const lines = formatTable({
      headers: styledHeaders,
      rows: styledRows,
      textStyler: taggingTextStyler,
    });

    expect(lines).toEqual([
      '<dim>┌──────────┬────────┐</dim>',
      '<dim>│</dim> <bold>NAME</bold>     <dim>│</dim> <bold>MODE</bold>   <dim>│</dim>',
      '<dim>├──────────┼────────┤</dim>',
      '<dim>│</dim> <cyan>personal</cyan> <dim>│</dim> auto   <dim>│</dim>',
      '<dim>│</dim> <green>team</green>     <dim>│</dim> manual <dim>│</dim>',
      '<dim>└──────────┴────────┘</dim>',
    ]);
  });

  it('never shifts a column when text is styled', () => {
    const plainLines = formatTable({
      headers: styledHeaders,
      rows: styledRows,
      textStyler: plainTextStyler,
    });
    const taggedLines = formatTable({
      headers: styledHeaders,
      rows: styledRows,
      textStyler: taggingTextStyler,
    });

    expect(
      taggedLines.map((line) => line.replace(/<\/?(bold|dim|cyan|yellow|red|green|magenta)>/g, '')),
    ).toEqual(plainLines);
    expect(new Set(plainLines.map((line) => line.length)).size).toBe(1);
  });

  it('throws when a row is shorter than the headers', () => {
    expect(() =>
      formatTable({
        headers: ['NAME', 'MODE'],
        rows: [[{ text: 'personal' }]],
        textStyler: plainTextStyler,
      }),
    ).toThrow('Table row 0 has 1 cells, but the table has 2 headers.');
  });

  it('throws when a row is longer than the headers', () => {
    expect(() =>
      formatTable({
        headers: ['NAME'],
        rows: [[{ text: 'personal' }], [{ text: 'team' }, { text: 'manual' }]],
        textStyler: plainTextStyler,
      }),
    ).toThrow('Table row 1 has 2 cells, but the table has 1 headers.');
  });

  it('draws only the header box when there are no rows', () => {
    const lines = formatTable({ headers: ['NAME', 'MODE'], rows: [], textStyler: plainTextStyler });

    expect(lines).toEqual(['┌──────┬──────┐', '│ NAME │ MODE │', '├──────┼──────┤', '└──────┴──────┘']);
  });
});

describe('formatTable fitting', () => {
  const unfittedLines = formatTable({
    headers: styledHeaders,
    rows: styledRows,
    textStyler: plainTextStyler,
  });
  const unfittedWidth = unfittedLines[0]?.length ?? 0;

  it('prints the same table when maxWidth is undefined', () => {
    const lines = formatTable({
      headers: styledHeaders,
      rows: styledRows,
      textStyler: plainTextStyler,
      overflow: { kind: 'wrap-column', columnIndex: 1 },
    });

    expect(lines).toEqual(unfittedLines);
  });

  it.each<TableOverflow>([
    { kind: 'wrap-column', columnIndex: 1 },
    { kind: 'split-columns', frozenColumnCount: 1 },
  ])('prints the same table when it is already within maxWidth, for $kind', (overflow) => {
    const lines = formatTable({
      headers: styledHeaders,
      rows: styledRows,
      textStyler: plainTextStyler,
      maxWidth: unfittedWidth,
      overflow,
    });

    expect(lines).toEqual(unfittedLines);
  });

  it('prints a table wider than maxWidth unfitted when no overflow is given', () => {
    const lines = formatTable({
      headers: styledHeaders,
      rows: styledRows,
      textStyler: plainTextStyler,
      maxWidth: unfittedWidth - 5,
    });

    expect(lines).toEqual(unfittedLines);
  });

  it('throws when wrap-column names a column past the last one', () => {
    expect(() =>
      formatTable({
        headers: styledHeaders,
        rows: styledRows,
        textStyler: plainTextStyler,
        overflow: { kind: 'wrap-column', columnIndex: styledHeaders.length },
      }),
    ).toThrow('Table overflow wraps column 2, but the table has 2 columns.');
  });

  it('throws when split-columns freezes more columns than the table has', () => {
    expect(() =>
      formatTable({
        headers: styledHeaders,
        rows: styledRows,
        textStyler: plainTextStyler,
        overflow: { kind: 'split-columns', frozenColumnCount: styledHeaders.length + 1 },
      }),
    ).toThrow('Table overflow freezes 3 columns, but the table has 2 columns.');
  });

  describe('wrap-column', () => {
    const overflow: TableOverflow = { kind: 'wrap-column', columnIndex: 1 };

    it('narrows the column until the table is exactly maxWidth wide, breaking its cell after a slash', () => {
      const lines = formatTable({
        headers: ['NAME', 'MODE', 'STATE', 'PATH'],
        rows: [
          [
            { text: 'app' },
            { text: 'manual' },
            { text: 'ok' },
            { text: '/Users/me/projects/my-app/.claude/skills' },
          ],
        ],
        textStyler: plainTextStyler,
        maxWidth: 54,
        overflow: { kind: 'wrap-column', columnIndex: 3 },
      });

      expect(lines).toEqual([
        '┌──────┬────────┬───────┬────────────────────────────┐',
        '│ NAME │ MODE   │ STATE │ PATH                       │',
        '├──────┼────────┼───────┼────────────────────────────┤',
        '│ app  │ manual │ ok    │ /Users/me/projects/my-app/ │',
        '│      │        │       │ .claude/skills             │',
        '└──────┴────────┴───────┴────────────────────────────┘',
      ]);
      expect(lines.map((line) => line.length)).toEqual(lines.map(() => 54));
    });

    it('makes each row as tall as its own wrapped cell, with the other cells blank on the extra lines', () => {
      const lines = formatTable({
        headers: ['NAME', 'PATH'],
        rows: [
          [{ text: 'a' }, { text: '/aaaa/bbbb/cccc' }],
          [{ text: 'b' }, { text: '/aaaa/bb' }],
          [{ text: 'c' }, { text: '/x' }],
        ],
        textStyler: plainTextStyler,
        maxWidth: 17,
        overflow,
      });

      expect(lines).toEqual([
        '┌──────┬────────┐',
        '│ NAME │ PATH   │',
        '├──────┼────────┤',
        '│ a    │ /aaaa/ │',
        '│      │ bbbb/  │',
        '│      │ cccc   │',
        '│ b    │ /aaaa/ │',
        '│      │ bb     │',
        '│ c    │ /x     │',
        '└──────┴────────┘',
      ]);
    });

    it('prints a piece longer than the column whole on its own line, pushing only that border out', () => {
      const lines = formatTable({
        headers: ['NAME', 'PATH'],
        rows: [[{ text: 'a' }, { text: '/short/muchlongersegment/end' }]],
        textStyler: plainTextStyler,
        maxWidth: 17,
        overflow,
      });

      expect(lines).toEqual([
        '┌──────┬────────┐',
        '│ NAME │ PATH   │',
        '├──────┼────────┤',
        '│ a    │ /      │',
        '│      │ short/ │',
        '│      │ muchlongersegment/ │',
        '│      │ end    │',
        '└──────┴────────┘',
      ]);
    });

    it('never narrows the column below its header, even when the other columns alone exceed maxWidth', () => {
      const lines = formatTable({
        headers: ['NAME', 'PATH'],
        rows: [[{ text: 'a-very-long-workspace-name' }, { text: '/aa/bb/cc' }]],
        textStyler: plainTextStyler,
        maxWidth: 20,
        overflow,
      });

      expect(lines).toEqual([
        '┌────────────────────────────┬──────┐',
        '│ NAME                       │ PATH │',
        '├────────────────────────────┼──────┤',
        '│ a-very-long-workspace-name │ /aa/ │',
        '│                            │ bb/  │',
        '│                            │ cc   │',
        '└────────────────────────────┴──────┘',
      ]);
    });

    it('styles each line of a wrapped cell, leaving its padding and the blank cells unstyled', () => {
      const lines = formatTable({
        headers: ['NAME', 'PATH'],
        rows: [
          [
            { text: 'a', style: 'cyan' },
            { text: '/aaaa/bb', style: 'yellow' },
          ],
        ],
        textStyler: taggingTextStyler,
        maxWidth: 17,
        overflow,
      });

      expect(lines).toEqual([
        '<dim>┌──────┬────────┐</dim>',
        '<dim>│</dim> <bold>NAME</bold> <dim>│</dim> <bold>PATH</bold>   <dim>│</dim>',
        '<dim>├──────┼────────┤</dim>',
        '<dim>│</dim> <cyan>a</cyan>    <dim>│</dim> <yellow>/aaaa/</yellow> <dim>│</dim>',
        '<dim>│</dim>      <dim>│</dim> <yellow>bb</yellow>     <dim>│</dim>',
        '<dim>└──────┴────────┘</dim>',
      ]);
    });
  });

  describe('split-columns', () => {
    const overflow: TableOverflow = { kind: 'split-columns', frozenColumnCount: 1 };

    it.each([30, 37])(
      'deals the columns in order into stacked tables that each repeat the frozen column, at a maxWidth of %i',
      (maxWidth) => {
        const lines = formatTable({
          headers: ['SKILL', 'personal', 'work', 'codex', 'gemini'],
          rows: [
            [
              { text: 'archify' },
              { text: 'link' },
              { text: 'clone' },
              { text: 'link' },
              { text: 'link' },
            ],
          ],
          textStyler: plainTextStyler,
          maxWidth,
          overflow,
        });

        expect(lines).toEqual([
          '┌─────────┬──────────┬───────┐',
          '│ SKILL   │ personal │ work  │',
          '├─────────┼──────────┼───────┤',
          '│ archify │ link     │ clone │',
          '└─────────┴──────────┴───────┘',
          '┌─────────┬───────┬────────┐',
          '│ SKILL   │ codex │ gemini │',
          '├─────────┼───────┼────────┤',
          '│ archify │ link  │ link   │',
          '└─────────┴───────┴────────┘',
        ]);
      },
    );

    it('gives a column too wide to fit beside the frozen one a table of its own, overflowing', () => {
      const lines = formatTable({
        headers: ['SKILL', 'a-very-long-workspace-name', 'work'],
        rows: [[{ text: 'archify' }, { text: 'link' }, { text: 'clone' }]],
        textStyler: plainTextStyler,
        maxWidth: 20,
        overflow,
      });

      expect(lines).toEqual([
        '┌─────────┬────────────────────────────┐',
        '│ SKILL   │ a-very-long-workspace-name │',
        '├─────────┼────────────────────────────┤',
        '│ archify │ link                       │',
        '└─────────┴────────────────────────────┘',
        '┌─────────┬───────┐',
        '│ SKILL   │ work  │',
        '├─────────┼───────┤',
        '│ archify │ clone │',
        '└─────────┴───────┘',
      ]);
    });

    it('prints a table with nothing after its frozen columns as it is, even when wider than maxWidth', () => {
      const lines = formatTable({
        headers: ['SKILL'],
        rows: [[{ text: 'a-long-skill-name' }]],
        textStyler: plainTextStyler,
        maxWidth: 5,
        overflow,
      });

      expect(lines).toEqual([
        '┌───────────────────┐',
        '│ SKILL             │',
        '├───────────────────┤',
        '│ a-long-skill-name │',
        '└───────────────────┘',
      ]);
    });
  });
});
