import type { TextStyle, TextStyler } from '@/lib/text-styler';

export type TableCell = { text: string; style?: TextStyle };

export type FormatTableParams = {
  headers: string[];
  rows: TableCell[][];
  textStyler: TextStyler;
};

/** The lines of a boxed table, left-aligned, each column as wide as its longest text. */
export function formatTable(params: FormatTableParams): string[] {
  const { headers, rows, textStyler } = params;

  rows.forEach((row, rowIndex) => {
    if (row.length !== headers.length) {
      throw new Error(
        `Table row ${rowIndex} has ${row.length} cells, but the table has ${headers.length} headers.`,
      );
    }
  });

  const columnWidths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => row[columnIndex]?.text.length ?? 0)),
  );
  const headerCells = headers.map((header): TableCell => ({ text: header, style: 'bold' }));

  return [
    formatBorderLine({ glyphs: { left: '┌', join: '┬', right: '┐' }, columnWidths, textStyler }),
    formatContentLine({ cells: headerCells, columnWidths, textStyler }),
    formatBorderLine({ glyphs: { left: '├', join: '┼', right: '┤' }, columnWidths, textStyler }),
    ...rows.map((row) => formatContentLine({ cells: row, columnWidths, textStyler })),
    formatBorderLine({ glyphs: { left: '└', join: '┴', right: '┘' }, columnWidths, textStyler }),
  ];
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

type FormattingParams = {
  textStyler: TextStyler;
  columnWidths: number[];
};

type FormatBorderLineParams = FormattingParams & {
  glyphs: { left: string; join: string; right: string };
};

function formatBorderLine(params: FormatBorderLineParams): string {
  const { glyphs, columnWidths, textStyler } = params;
  const fillRuns = columnWidths.map((columnWidth) => '─'.repeat(columnWidth + 2));

  return textStyler('dim', `${glyphs.left}${fillRuns.join(glyphs.join)}${glyphs.right}`);
}

type FormatContentLineParams = FormattingParams & {
  cells: TableCell[];
};

function formatContentLine(params: FormatContentLineParams): string {
  const { cells, columnWidths, textStyler } = params;
  const bar = textStyler('dim', '│');

  const paddedCells = cells.map((cell, columnIndex) => {
    const columnWidth = columnWidths[columnIndex] ?? cell.text.length;
    const padding = ' '.repeat(columnWidth - cell.text.length);
    const cellText = cell.style === undefined ? cell.text : textStyler(cell.style, cell.text);

    return ` ${cellText}${padding} `;
  });

  return `${bar}${paddedCells.join(bar)}${bar}`;
}
