import { describe, expect, it } from 'vitest';
import type { TextStyler } from '@/lib/text-styler';
import { formatTable, type TableCell } from '@/lib/text-table';

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

    expect(taggedLines.map((line) => line.replace(/<\/?[a-z]+>/g, ''))).toEqual(plainLines);
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
