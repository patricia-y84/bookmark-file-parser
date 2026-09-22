# bookmark-file-parser

Parses the bookmark HTML file that every browser produces from "Export
Bookmarks" — Chrome, Firefox, Safari, and Edge all still write some variant
of the old `NETSCAPE-Bookmark-file-1` format — into a plain tree of folders
and links.

## Why

There's no real specification for this format, just a 1998 Netscape doctype
string that everyone kept copying. It's HTML in name only: tags like `<DT>`
and `<p>` are never closed, attribute quoting is inconsistent between
browsers and even between versions of the same browser, and it's common for
these files to get hand-edited or truncated by some unrelated tool before
you see them.

Feed a broken one into `DOMParser` or a generic HTML parser and you get
either a silently mangled document tree or an error that says "invalid
markup" with no indication of where. This library parses the format
directly with its own tokenizer, and when something is wrong, the error
tells you exactly where: line, column, and a caret pointing at the
offending character.

## Usage

```typescript
import { readFileSync } from 'node:fs';
import { parseBookmarks } from 'bookmark-file-parser';

const source = readFileSync('bookmarks.html', 'utf8');
const roots = parseBookmarks(source);

for (const node of roots) {
  if (node.type === 'folder') {
    console.log(`folder: ${node.title} (${node.children.length} items)`);
  } else {
    console.log(`link: ${node.title} -> ${node.url}`);
  }
}
```

## When parsing fails

```typescript
import { parseBookmarks, BookmarkParseError } from 'bookmark-file-parser';

const broken = [
  '<DL><p>',
  '    <DT><H3>Work</H3>',
  '    <DL><p>',
  '        <DT><A HREF="https://example.com">Example</A>',
  '    </DL><p>',
  '',
].join('\n'); // missing the closing </DL> for the outer list

try {
  parseBookmarks(broken);
} catch (error) {
  if (error instanceof BookmarkParseError) {
    console.error(error.message);
    console.error(error.annotate());
  }
}
```

This prints:

```
reached end of input with "<DL>" (opened at line 1, column 1) still open (line 6, column 1)
6 |
  | ^
```

Every error - a missing `HREF`, a stray closing tag, an unterminated quoted
attribute, an unknown element - reports a position the same way, so you can
jump straight to the problem in an editor instead of guessing.

## What you get back

```typescript
type BookmarkNode = BookmarkFolder | BookmarkLink;

interface BookmarkFolder {
  type: 'folder';
  title: string;
  addDate?: number;
  lastModified?: number;
  children: BookmarkNode[];
}

interface BookmarkLink {
  type: 'link';
  title: string;
  url: string;
  addDate?: number;
  lastModified?: number;
  icon?: string;
}
```

`addDate` and `lastModified` are Unix timestamps in seconds, the same units
the browser writes them in. `icon` is whatever the browser embedded, usually
a `data:` URL.

## Status

Early. Parsing works for real export files from Chrome, Firefox, and
Safari. Not yet covered: serializing a tree back into the file format, and
the `<DD>` description tag that some older exports include. No package is
published yet - clone the repo and run `npm run build` to produce `dist/`.

## License

MIT, see [LICENSE](./LICENSE).
