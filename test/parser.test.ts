import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseBookmarks, BookmarkFolder, BookmarkLink } from '../src/parser';

// Fixtures are modeled on the structural differences between real
// "Export Bookmarks" output from Chrome, Firefox, and Safari: which
// attributes each browser writes on <H3>/<A>, tag casing, and how the
// toolbar/menu root folders are named. None of them use <DD>, which the
// parser doesn't support yet.
//
// Paths are relative to the process cwd, which is the package root when
// this runs via `npm test`.
function loadFixture(name: string): string {
  return readFileSync(`test/fixtures/${name}`, 'utf8');
}

function asFolder(node: { type: string }): BookmarkFolder {
  assert.equal(node.type, 'folder');
  return node as BookmarkFolder;
}

function asLink(node: { type: string }): BookmarkLink {
  assert.equal(node.type, 'link');
  return node as BookmarkLink;
}

test('parses a Chrome export', () => {
  const roots = parseBookmarks(loadFixture('chrome-export.html'));
  assert.equal(roots.length, 1);

  const bar = asFolder(roots[0]);
  assert.equal(bar.title, 'Bookmarks bar');
  assert.equal(bar.addDate, 1700000000);
  assert.equal(bar.lastModified, 1700000500);
  assert.equal(bar.children.length, 2);

  const example = asLink(bar.children[0]);
  assert.equal(example.title, 'Example');
  assert.equal(example.url, 'https://example.com/');
  assert.equal(example.addDate, 1700000100);
  assert.equal(example.icon, 'data:image/png;base64,AAAA');

  const work = asFolder(bar.children[1]);
  assert.equal(work.title, 'Work');
  assert.equal(work.children.length, 1);
  const docs = asLink(work.children[0]);
  assert.equal(docs.url, 'https://example.org/docs');
});

test('parses a Firefox export', () => {
  const roots = parseBookmarks(loadFixture('firefox-export.html'));
  assert.equal(roots.length, 2);

  const toolbar = asFolder(roots[0]);
  assert.equal(toolbar.title, 'Bookmarks Toolbar');
  assert.equal(toolbar.children.length, 1);

  // Firefox writes both ICON (a data: URL) and ICON_URI (the original
  // favicon URL) on <A>; only ICON is part of the parsed shape today.
  const link = asLink(toolbar.children[0]);
  assert.equal(link.title, 'Example Net');
  assert.equal(link.url, 'https://example.net/');
  assert.equal(link.icon, 'data:image/png;base64,BBBB');

  const readingList = asFolder(roots[1]);
  assert.equal(readingList.title, 'Reading list');
  const paper = asLink(readingList.children[0]);
  assert.equal(paper.url, 'https://example.edu/paper');
  assert.equal(paper.addDate, 1690000300);
  assert.equal(paper.lastModified, 1690000400);
});

test('parses a Safari export', () => {
  // Safari lowercases every tag and attribute name; the tokenizer
  // uppercases both while reading, so this should parse identically
  // to the Chrome/Firefox fixtures despite the casing difference.
  const roots = parseBookmarks(loadFixture('safari-export.html'));
  assert.equal(roots.length, 2);

  const favorites = asFolder(roots[0]);
  assert.equal(favorites.title, 'favorites');
  const safariLink = asLink(favorites.children[0]);
  assert.equal(safariLink.url, 'https://example.com/safari');
  assert.equal(safariLink.addDate, 1680000000);

  const readingList = asFolder(roots[1]);
  assert.equal(readingList.title, 'com.apple.ReadingList');
  const readLater = asLink(readingList.children[0]);
  assert.equal(readLater.url, 'https://example.com/read-later');
});
