const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  isMarkdownPath,
  isPathInside,
  resolveLocalPath,
  resolveLinkedDocument,
  toResourceUrl,
} = require('../../src/main-utils');

const root = path.resolve('C:/temp/MDView test');
const documentPath = path.join(root, 'documento.md');

test('riconosce le estensioni Markdown senza distinzione tra maiuscole e minuscole', () => {
  assert.equal(isMarkdownPath('nota.MD'), true);
  assert.equal(isMarkdownPath('nota.markdown'), true);
  assert.equal(isMarkdownPath('nota.txt'), true);
  assert.equal(isMarkdownPath('nota.html'), false);
  assert.equal(isMarkdownPath(null), false);
});

test('il controllo dei percorsi blocca directory esterne e prefissi ambigui', () => {
  assert.equal(isPathInside(root, path.join(root, 'assets', 'a.png')), true);
  assert.equal(isPathInside(root, path.join(root, '..', 'altro', 'a.png')), false);
  assert.equal(isPathInside(root, `${root}-private`), false);
});

test('risolve risorse locali, spazi e caratteri codificati', () => {
  const expected = path.join(root, 'assets', 'mia immagine.png');
  assert.equal(resolveLocalPath(documentPath, 'assets/mia%20immagine.png'), expected);
  assert.equal(resolveLocalPath(documentPath, toResourceUrl(expected)), expected);
  assert.equal(resolveLocalPath(documentPath, 'https://example.com/a.png'), null);
  assert.equal(resolveLocalPath(documentPath, '../segreto.txt'), null);
});

test('apre solo collegamenti Markdown locali nella cartella consentita', () => {
  assert.equal(resolveLinkedDocument(documentPath, 'altro.md'), path.join(root, 'altro.md'));
  assert.equal(resolveLinkedDocument(documentPath, 'altro.md#titolo'), path.join(root, 'altro.md'));
  assert.equal(resolveLinkedDocument(documentPath, 'immagine.png'), null);
  assert.equal(resolveLinkedDocument(documentPath, '../altro.md'), null);
});
