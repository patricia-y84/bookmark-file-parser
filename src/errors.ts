export interface Position {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/**
 * Thrown by parseBookmarks() when the input doesn't match the Netscape
 * bookmark file grammar. Carries the exact source position so a caller
 * can point a human at the problem instead of just saying "invalid".
 */
export class BookmarkParseError extends Error {
  readonly offset: number;
  readonly line: number;
  readonly column: number;

  private readonly source: string;

  constructor(message: string, position: Position, source: string) {
    super(`${message} (line ${position.line}, column ${position.column})`);
    this.name = 'BookmarkParseError';
    this.offset = position.offset;
    this.line = position.line;
    this.column = position.column;
    this.source = source;
  }

  /**
   * Renders the offending source line with a caret under the column,
   * the way a compiler would. Meant for printing to a terminal.
   */
  annotate(): string {
    const lineText = this.source.split('\n')[this.line - 1] ?? '';
    const gutter = String(this.line);
    const caret = `${' '.repeat(Math.max(0, this.column - 1))}^`;
    return `${gutter} | ${lineText}\n${' '.repeat(gutter.length)} | ${caret}`;
  }
}
