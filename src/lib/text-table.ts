import type { TextStyle, TextStyler } from '@/lib/text-styler';
import { assertUnreachable } from '@/lib/utils';

export type TableCell = { text: string; style?: TextStyle };

/** What gives way when a table is wider than its `maxWidth`. */
export type TableOverflow =
  { kind: 'wrap-column'; columnIndex: number } | { kind: 'split-columns'; frozenColumnCount: number };

export type FormatTableParams = {
  headers: string[];
  rows: TableCell[][];
  textStyler: TextStyler;
  maxWidth?: number;
  overflow?: TableOverflow;
};

/** The lines of a boxed table, left-aligned, each column as wide as its longest text. */
export function formatTable(params: FormatTableParams): string[] {
  const { headers, rows, textStyler, maxWidth, overflow } = params;

  rows.forEach((row, rowIndex) => {
    if (row.length !== headers.length) {
      throw new Error(
        `Table row ${rowIndex} has ${row.length} cells, but the table has ${headers.length} headers.`,
      );
    }
  });

  if (overflow !== undefined) {
    assertOverflowWithinTable({ overflow, columnCount: headers.length });
  }

  const columnWidths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => row[columnIndex]?.text.length ?? 0)),
  );

  const tableWidth = getTableWidth(columnWidths);

  if (maxWidth === undefined || overflow === undefined || tableWidth <= maxWidth) {
    return formatTableLines({ headers, rows, columnWidths, textStyler });
  }

  switch (overflow.kind) {
    case 'wrap-column': {
      const { columnIndex } = overflow;
      const wrappedColumnWidth = Math.max(
        headers[columnIndex]?.length ?? 0,
        (columnWidths[columnIndex] ?? 0) - (tableWidth - maxWidth),
      );

      return formatTableLines({
        headers,
        rows,
        columnWidths: columnWidths.map((columnWidth, index) =>
          index === columnIndex ? wrappedColumnWidth : columnWidth,
        ),
        textStyler,
      });
    }

    case 'split-columns': {
      const { frozenColumnCount } = overflow;
      const columnGroups = getColumnGroups({ columnWidths, frozenColumnCount, maxWidth });

      if (columnGroups.length === 0) {
        return formatTableLines({ headers, rows, columnWidths, textStyler });
      }

      return columnGroups.flatMap((columnGroup) => {
        const isInTable = (_: unknown, columnIndex: number) =>
          columnIndex < frozenColumnCount || columnGroup.includes(columnIndex);

        return formatTableLines({
          headers: headers.filter(isInTable),
          rows: rows.map((row) => row.filter(isInTable)),
          columnWidths: columnWidths.filter(isInTable),
          textStyler,
        });
      });
    }

    default:
      return assertUnreachable(overflow);
  }
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function assertOverflowWithinTable(params: { overflow: TableOverflow; columnCount: number }): void {
  const { overflow, columnCount } = params;

  switch (overflow.kind) {
    case 'wrap-column': {
      const { columnIndex } = overflow;

      if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= columnCount) {
        throw new Error(
          `Table overflow wraps column ${columnIndex}, but the table has ${columnCount} columns.`,
        );
      }

      return;
    }

    case 'split-columns': {
      const { frozenColumnCount } = overflow;

      if (
        !Number.isInteger(frozenColumnCount) ||
        frozenColumnCount < 0 ||
        frozenColumnCount > columnCount
      ) {
        throw new Error(
          `Table overflow freezes ${frozenColumnCount} columns, but the table has ${columnCount} columns.`,
        );
      }

      return;
    }

    default:
      assertUnreachable(overflow);
  }
}

function getTableWidth(columnWidths: number[]): number {
  return columnWidths.reduce((tableWidth, columnWidth) => tableWidth + columnWidth + 3, 1);
}

/** The columns after the frozen ones, by index, dealt in order into groups that each fit beside them. */
function getColumnGroups(params: {
  columnWidths: number[];
  frozenColumnCount: number;
  maxWidth: number;
}): number[][] {
  const { columnWidths, frozenColumnCount, maxWidth } = params;
  const frozenColumnWidths = columnWidths.slice(0, frozenColumnCount);

  return columnWidths.slice(frozenColumnCount).reduce<number[][]>((groups, columnWidth, offset) => {
    const columnIndex = frozenColumnCount + offset;
    const lastGroup = groups.at(-1);
    const fitsLastGroup =
      lastGroup !== undefined &&
      getTableWidth([
        ...frozenColumnWidths,
        ...lastGroup.map((groupColumnIndex) => columnWidths[groupColumnIndex] ?? 0),
        columnWidth,
      ]) <= maxWidth;

    return fitsLastGroup
      ? [...groups.slice(0, -1), [...lastGroup, columnIndex]]
      : [...groups, [columnIndex]];
  }, []);
}

/** `text` broken after its slashes into lines of at most `width`; a longer piece keeps a line to itself. */
function wrapAfterSlashes(params: { text: string; width: number }): string[] {
  const { text, width } = params;

  return text.split(/(?<=\/)/).reduce<string[]>((lines, piece) => {
    const lastLine = lines.at(-1);

    if (lastLine === undefined || lastLine.length + piece.length > width) {
      return [...lines, piece];
    }

    return [...lines.slice(0, -1), `${lastLine}${piece}`];
  }, []);
}

type FormattingParams = {
  textStyler: TextStyler;
  columnWidths: number[];
};

type FormatTableLinesParams = FormattingParams & {
  headers: string[];
  rows: TableCell[][];
};

function formatTableLines(params: FormatTableLinesParams): string[] {
  const { headers, rows, columnWidths, textStyler } = params;
  const headerCells = headers.map((header): TableCell => ({ text: header, style: 'bold' }));

  return [
    formatBorderLine({ glyphs: { left: '┌', join: '┬', right: '┐' }, columnWidths, textStyler }),
    formatContentLine({ cells: headerCells, columnWidths, textStyler }),
    formatBorderLine({ glyphs: { left: '├', join: '┼', right: '┤' }, columnWidths, textStyler }),
    ...rows.flatMap((row) => formatRowLines({ cells: row, columnWidths, textStyler })),
    formatBorderLine({ glyphs: { left: '└', join: '┴', right: '┘' }, columnWidths, textStyler }),
  ];
}

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

/**
 * A cell wraps when its column is narrower than its text. A row is as tall as its tallest
 * cell; a shorter cell is blank on the lines below its own.
 */
function formatRowLines(params: FormatContentLineParams): string[] {
  const { cells, columnWidths, textStyler } = params;

  const cellLines = cells.map((cell, columnIndex) =>
    wrapAfterSlashes({ text: cell.text, width: columnWidths[columnIndex] ?? cell.text.length }),
  );
  const rowHeight = Math.max(1, ...cellLines.map((lines) => lines.length));

  return Array.from({ length: rowHeight }, (_, lineIndex) =>
    formatContentLine({
      cells: cells.map((cell, columnIndex): TableCell => {
        const text = cellLines[columnIndex]?.[lineIndex];

        return text === undefined ? { text: '' } : { ...cell, text };
      }),
      columnWidths,
      textStyler,
    }),
  );
}

function formatContentLine(params: FormatContentLineParams): string {
  const { cells, columnWidths, textStyler } = params;
  const bar = textStyler('dim', '│');

  const paddedCells = cells.map((cell, columnIndex) => {
    const columnWidth = columnWidths[columnIndex] ?? cell.text.length;
    const padding = ' '.repeat(Math.max(0, columnWidth - cell.text.length));
    const cellText = cell.style === undefined ? cell.text : textStyler(cell.style, cell.text);

    return ` ${cellText}${padding} `;
  });

  return `${bar}${paddedCells.join(bar)}${bar}`;
}
