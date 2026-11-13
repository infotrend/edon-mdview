const test = require('node:test');
const assert = require('node:assert/strict');
const { getSchema } = require('@tiptap/core');
const { EditorState } = require('@tiptap/pm/state');
const { createExtensions } = require('../../src/renderer/editor/extensions');
const { createMarkdownBridge } = require('../../src/renderer/editor/markdown-bridge');
const { findMatches, createSearchPlugin, searchKey, MATCH_LIMIT } = require('../../src/renderer/editor/search');

const schema = getSchema(createExtensions());
const bridge = createMarkdownBridge(schema);
const parse = (source) => bridge.parse(source).doc;
const found = (doc, query) => findMatches(doc, query).map(({ from, to }) => doc.textBetween(from, to));

test('trova le occorrenze senza distinguere maiuscole e minuscole', () => {
  const doc = parse('# Markdown\n\nUn markdown e un MARKDOWN, poi basta.\n');
  assert.deepEqual(found(doc, 'markdown'), ['Markdown', 'markdown', 'MARKDOWN']);
  assert.deepEqual(found(doc, 'MarkDown'), ['Markdown', 'markdown', 'MARKDOWN']);
  assert.deepEqual(found(doc, 'assente'), []);
  assert.deepEqual(found(doc, ''), []);
});

test('trova un\'occorrenza a cavallo di formattazioni diverse nello stesso blocco', () => {
  const doc = parse('Una parola **impor**tante e un [colle](https://example.com)*gamento*.\n');
  assert.deepEqual(found(doc, 'importante'), ['importante']);
  assert.deepEqual(found(doc, 'collegamento'), ['collegamento']);
  assert.deepEqual(found(doc, 'parola importante e'), ['parola importante e']);
});

test('non unisce blocchi diversi né il testo separato da elementi in linea non testuali', () => {
  assert.deepEqual(found(parse('alfa\n\nbeta\n'), 'alfabeta'), []);
  assert.deepEqual(found(parse('- alfa\n- beta\n'), 'alfabeta'), []);
  // Hard break and protected inline HTML sit between the two halves.
  assert.deepEqual(found(parse('alfa  \nbeta\n'), 'alfabeta'), []);
  assert.deepEqual(found(parse('alfa<br>beta\n'), 'alfabeta'), []);
});

test('cerca in titoli, elenchi, tabelle e blocchi di codice', () => {
  const doc = parse([
    '## Chiave del titolo',
    '',
    '- voce con chiave',
    '',
    '| Nome | Valore |',
    '|------|--------|',
    '| chiave | 1 |',
    '',
    '```js',
    'const chiave = 1;',
    '```',
    '',
  ].join('\n'));
  assert.equal(findMatches(doc, 'chiave').length, 4);
});

test('non cerca nel contenuto degli elementi protetti', () => {
  const doc = parse([
    'Premi <kbd>Ctrl</kbd> e leggi la nota[^1].',
    '',
    '[^1]: Testo segreto della nota.',
    '',
    '<details><summary>Segreto</summary>Altro segreto.</details>',
    '',
  ].join('\n'));
  assert.deepEqual(found(doc, 'segreto'), []);
  assert.deepEqual(found(doc, 'kbd'), []);
  assert.deepEqual(found(doc, 'ctrl'), ['Ctrl']);
});

test('le posizioni restano corrette quando il minuscolo cambia la lunghezza del testo', () => {
  const doc = parse('İstanbul e poi İSTANBUL ancora.\n');
  assert.deepEqual(found(doc, 'ancora'), ['ancora']);
  assert.deepEqual(found(doc, 'poi'), ['poi']);
});

test('si ferma al numero massimo di risultati', () => {
  const doc = parse(`${'a '.repeat(MATCH_LIMIT + 50)}\n`);
  assert.equal(findMatches(doc, 'a').length, MATCH_LIMIT);
  assert.equal(findMatches(doc, 'a', 3).length, 3);
});

test('il plugin evidenzia con decorazioni senza modificare il documento', () => {
  const doc = parse('Primo termine.\n\nSecondo **ter**mine e terzo Termine.\n');
  let state = EditorState.create({ schema, doc, plugins: [createSearchPlugin()] });
  const apply = (meta) => {
    const transaction = state.tr.setMeta(searchKey, meta);
    assert.equal(transaction.docChanged, false);
    state = state.apply(transaction);
    return searchKey.getState(state);
  };

  let search = apply({ type: 'search', query: 'termine' });
  assert.equal(search.matches.length, 3);
  assert.equal(search.current, 0);
  // The match split by the bold mark is still one match; each match is one inline decoration.
  const decorations = search.decorations.find();
  assert.equal(decorations.length, 3);
  assert.deepEqual(decorations.map((decoration) => decoration.type.attrs.class), ['search-highlight current', 'search-highlight', 'search-highlight']);
  assert.ok(decorations.every((decoration) => decoration.type.attrs.nodeName === 'mark'));

  search = apply({ type: 'activate', index: -1 });
  assert.equal(search.current, 2);
  search = apply({ type: 'activate', index: 3 });
  assert.equal(search.current, 0);
  assert.ok(state.doc.eq(doc));

  search = apply({ type: 'clear' });
  assert.equal(search.matches.length, 0);
  assert.equal(search.current, -1);
  assert.equal(search.decorations.find().length, 0);
  assert.ok(state.doc.eq(doc));
});

test('il plugin aggiorna le occorrenze quando il documento cambia', () => {
  const doc = parse('Uno termine.\n\nDue termine.\n\nTre termine.\n');
  let state = EditorState.create({ schema, doc, plugins: [createSearchPlugin()] });
  state = state.apply(state.tr.setMeta(searchKey, { type: 'search', query: 'termine' }));
  state = state.apply(state.tr.setMeta(searchKey, { type: 'activate', index: 1 }));
  const second = searchKey.getState(state).matches[1];

  // Typing before the active match keeps it active at its new position.
  state = state.apply(state.tr.insertText('termine e ', 1));
  let search = searchKey.getState(state);
  assert.equal(search.matches.length, 4);
  assert.equal(search.current, 2);
  assert.equal(search.matches[2].from, second.from + 'termine e '.length);

  // Breaking the active match moves on to the next one.
  const active = search.matches[2];
  state = state.apply(state.tr.delete(active.from, active.from + 2));
  search = searchKey.getState(state);
  assert.equal(search.matches.length, 3);
  assert.equal(search.current, 2);
  assert.equal(state.doc.textBetween(search.matches[2].from, search.matches[2].to), 'termine');

  // Without matches left nothing is active.
  state = state.apply(state.tr.delete(0, state.doc.content.size));
  search = searchKey.getState(state);
  assert.equal(search.matches.length, 0);
  assert.equal(search.current, -1);
});
