import { BookmarkParseError, Position } from './errors';

export interface BookmarkFolder {
  type: 'folder';
  title: string;
  addDate?: number;
  lastModified?: number;
  children: BookmarkNode[];
}

export interface BookmarkLink {
  type: 'link';
  title: string;
  url: string;
  addDate?: number;
  lastModified?: number;
  icon?: string;
}

export type BookmarkNode = BookmarkFolder | BookmarkLink;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

function parseTimestamp(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Walks the source string one character at a time, tracking line and column. */
class Scanner {
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly text: string) {}

  get position(): Position {
    return { offset: this.pos, line: this.line, column: this.column };
  }

  get atEnd(): boolean {
    return this.pos >= this.text.length;
  }

  peek(ahead = 0): string {
    return this.text[this.pos + ahead] ?? '';
  }

  next(): string {
    const ch = this.text[this.pos];
    this.pos += 1;
    if (ch === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  skipWhile(predicate: (ch: string) => boolean): string {
    let out = '';
    while (!this.atEnd && predicate(this.peek())) {
      out += this.next();
    }
    return out;
  }

  skipUntil(target: string): string {
    let out = '';
    while (!this.atEnd && !this.text.startsWith(target, this.pos)) {
      out += this.next();
    }
    return out;
  }

  consume(target: string): boolean {
    if (this.text.startsWith(target, this.pos)) {
      for (let i = 0; i < target.length; i += 1) this.next();
      return true;
    }
    return false;
  }
}

interface Tag {
  name: string;
  closing: boolean;
  attributes: Map<string, string>;
  start: Position;
}

const WHITESPACE = /\s/;
const NAME_CHAR = /[a-zA-Z0-9]/;
const ATTR_NAME_CHAR = /[^\s=>/]/;

function readTag(scanner: Scanner, source: string): Tag {
  const start = scanner.position;
  scanner.next(); // '<'
  const closing = scanner.peek() === '/';
  if (closing) scanner.next();

  const name = scanner.skipWhile((ch) => NAME_CHAR.test(ch)).toUpperCase();
  if (name === '') {
    throw new BookmarkParseError('expected a tag name after "<"', start, source);
  }

  const attributes = new Map<string, string>();
  for (;;) {
    scanner.skipWhile((ch) => WHITESPACE.test(ch));
    if (scanner.atEnd) {
      throw new BookmarkParseError(
        `unterminated tag "<${name}", reached end of input before ">"`,
        start,
        source,
      );
    }
    if (scanner.peek() === '>') {
      scanner.next();
      break;
    }
    if (scanner.peek() === '/' && scanner.peek(1) === '>') {
      scanner.next();
      scanner.next();
      break;
    }
    if (closing) {
      throw new BookmarkParseError(
        `unexpected content inside closing tag "</${name}>"`,
        scanner.position,
        source,
      );
    }

    const attrStart = scanner.position;
    const attrName = scanner.skipWhile((ch) => ATTR_NAME_CHAR.test(ch)).toUpperCase();
    if (attrName === '') {
      throw new BookmarkParseError(
        `unexpected character "${scanner.peek()}" in tag "<${name}>"`,
        attrStart,
        source,
      );
    }

    scanner.skipWhile((ch) => WHITESPACE.test(ch));
    if (scanner.peek() !== '=') {
      attributes.set(attrName, '');
      continue;
    }
    scanner.next(); // '='
    scanner.skipWhile((ch) => WHITESPACE.test(ch));

    const quote = scanner.peek();
    let value: string;
    if (quote === '"' || quote === "'") {
      const quoteStart = scanner.position;
      scanner.next();
      value = scanner.skipUntil(quote);
      if (scanner.atEnd) {
        throw new BookmarkParseError(
          `unterminated attribute value for "${attrName}", the opening quote here was never closed`,
          quoteStart,
          source,
        );
      }
      scanner.next(); // closing quote
    } else {
      value = scanner.skipWhile((ch) => !WHITESPACE.test(ch) && ch !== '>');
    }
    attributes.set(attrName, decodeEntities(value));
  }

  return { name, closing, attributes, start };
}

/** Skips `<!DOCTYPE ...>` declarations and `<!-- ... -->` comments. */
function skipDeclaration(scanner: Scanner): void {
  if (scanner.consume('<!--')) {
    scanner.skipUntil('-->');
    scanner.consume('-->');
    return;
  }
  scanner.next(); // '<'
  scanner.next(); // '!'
  scanner.skipUntil('>');
  scanner.consume('>');
}

function readText(scanner: Scanner): string {
  return decodeEntities(scanner.skipUntil('<'));
}

function expectClosingTag(scanner: Scanner, source: string, name: string, openStart: Position): void {
  scanner.skipWhile((ch) => WHITESPACE.test(ch));
  if (scanner.atEnd || scanner.peek() !== '<') {
    throw new BookmarkParseError(
      `expected closing "</${name}>" for the tag opened at line ${openStart.line}, ` +
        `column ${openStart.column}, but reached end of input`,
      scanner.position,
      source,
    );
  }
  const tag = readTag(scanner, source);
  if (!tag.closing || tag.name !== name) {
    const found = `${tag.closing ? '</' : '<'}${tag.name}>`;
    throw new BookmarkParseError(
      `expected closing "</${name}>" for the tag opened at line ${openStart.line}, ` +
        `column ${openStart.column}, but found "${found}" instead`,
      tag.start,
      source,
    );
  }
}

interface Scope {
  readonly list: BookmarkNode[];
  readonly openTag: string | null;
  readonly openStart: Position | null;
}

/**
 * Parses the "NETSCAPE-Bookmark-file-1" HTML dialect that every major
 * browser writes when you export bookmarks. A general HTML parser won't
 * do here: the format relies on tags that are never closed (<DT>, <p>),
 * and we need exact source positions to give useful errors, which a DOM
 * parser throws away.
 */
export function parseBookmarks(source: string): BookmarkNode[] {
  const scanner = new Scanner(source);
  const roots: BookmarkNode[] = [];
  const scopes: Scope[] = [{ list: roots, openTag: null, openStart: null }];
  let pendingFolder: BookmarkFolder | null = null;

  const currentList = (): BookmarkNode[] => scopes[scopes.length - 1].list;

  while (!scanner.atEnd) {
    if (scanner.peek() !== '<') {
      scanner.next();
      continue;
    }
    if (scanner.peek(1) === '!') {
      skipDeclaration(scanner);
      continue;
    }

    const tag = readTag(scanner, source);

    if (tag.closing) {
      if (tag.name === 'DL') {
        if (scopes.length <= 1) {
          throw new BookmarkParseError('closing "</DL>" has no matching "<DL>"', tag.start, source);
        }
        scopes.pop();
      }
      // Stray closing tags like </DT> or </P> are harmless in this format; ignore them.
      continue;
    }

    switch (tag.name) {
      case 'META':
      case 'P':
      case 'DT':
        break;

      case 'TITLE':
      case 'H1':
        readText(scanner);
        expectClosingTag(scanner, source, tag.name, tag.start);
        break;

      case 'H3': {
        const title = readText(scanner).trim();
        expectClosingTag(scanner, source, 'H3', tag.start);
        const folder: BookmarkFolder = {
          type: 'folder',
          title,
          addDate: parseTimestamp(tag.attributes.get('ADD_DATE')),
          lastModified: parseTimestamp(tag.attributes.get('LAST_MODIFIED')),
          children: [],
        };
        currentList().push(folder);
        pendingFolder = folder;
        break;
      }

      case 'DL': {
        if (pendingFolder) {
          scopes.push({ list: pendingFolder.children, openTag: 'DL', openStart: tag.start });
          pendingFolder = null;
        } else {
          scopes.push({ list: currentList(), openTag: 'DL', openStart: tag.start });
        }
        break;
      }

      case 'A': {
        const href = tag.attributes.get('HREF');
        if (href === undefined) {
          throw new BookmarkParseError(
            'a bookmark link is missing the required "HREF" attribute',
            tag.start,
            source,
          );
        }
        const title = readText(scanner).trim();
        expectClosingTag(scanner, source, 'A', tag.start);
        const link: BookmarkLink = {
          type: 'link',
          title,
          url: href,
          addDate: parseTimestamp(tag.attributes.get('ADD_DATE')),
          lastModified: parseTimestamp(tag.attributes.get('LAST_MODIFIED')),
          icon: tag.attributes.get('ICON'),
        };
        currentList().push(link);
        pendingFolder = null;
        break;
      }

      default:
        throw new BookmarkParseError(`unrecognized tag "<${tag.name}>"`, tag.start, source);
    }
  }

  const unclosed = scopes[scopes.length - 1];
  if (unclosed.openStart) {
    throw new BookmarkParseError(
      `reached end of input with "<${unclosed.openTag}>" (opened at line ${unclosed.openStart.line}, ` +
        `column ${unclosed.openStart.column}) still open`,
      scanner.position,
      source,
    );
  }

  return roots;
}
