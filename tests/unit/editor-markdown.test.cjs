const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getSchema } = require('@tiptap/core');
const { EditorState, TextSelection } = require('@tiptap/pm/state');
const { createExtensions } = require('../../src/renderer/editor/extensions');
const { createMarkdownBridge } = require('../../src/renderer/editor/markdown-bridge');

const schema = getSchema(createExtensions());
const bridge = createMarkdownBridge(schema);
const root = path.resolve(__dirname, '..', '..');

const roundTrip = (source) => {
  const { doc, origin } = bridge.parse(source);
  return bridge.serialize(doc, origin);
};

/** Serializes every block from scratch, as if the whole document had been rewritten in the editor. */
const regenerate = (source) => bridge.serialize(bridge.parse(source).doc, bridge.parse('').origin);

/** Applies a ProseMirror transaction to the parsed document and serializes the result. */
function edit(source, change) {
  const { doc, origin } = bridge.parse(source);
  const state = EditorState.create({ schema, doc });
  const transaction = state.tr;
  change(transaction, doc);
  return bridge.serialize(transaction.doc, origin);
}

function blockStart(doc, index) {
  let position = 0;
  for (let cursor = 0; cursor < index; cursor += 1) position += doc.child(cursor).nodeSize;
  return position;
}

const TRICKY = [
  '---',
  'title: Prova',
  '---',
  '',
  'Titolo setext',
  '=============',
  '',
  'Paragrafo con _enfasi_, __forte__ e un [link][ref] su',
  'due righe, una nota[^1] e <kbd>Ctrl</kbd>.',
  '',
  '[ref]: https://example.com "Esempio"',
  '',
  '[^1]: Testo della nota',
  '    su due righe.',
  '',
  '<div align="center">HTML</div>',
  '',
  '* uno',
  '* due',
  '',
  '+ [ ] da fare',
  '+ [X] fatto',
  '',
  '3) terzo',
  '4) quarto',
  '',
  '| Sinistra | Destra |',
  '|:---------|-------:|',
  '| a \\| b   |    `c` |',
  '',
  '    codice indentato',
  '',
  '~~~py title=demo',
  'print("ciao")',
  '~~~',
  '',
  '***',
  '',
  'https://example.com e <https://example.org/x> &copy; ^[nota in linea]',
  '',
].join('\n');

test('non modifica nulla quando il documento non viene toccato', () => {
  for (const file of ['tests/fixtures/documento.md', 'tests/fixtures/secondo.md', 'README.md']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(roundTrip(source), source, file);
  }
  assert.equal(roundTrip(TRICKY), TRICKY);
  for (const source of ['', '\n\n', 'solo testo', 'senza a capo finale\n\n\n', '\n\n# Vuoto sopra\n', '# A\nsubito sotto\n- elenco\n']) {
    assert.equal(roundTrip(source), source, JSON.stringify(source));
  }
});

test('preserva fine riga Windows, anche misti, e li usa per i blocchi nuovi', () => {
  const windows = '# Titolo\r\n\r\nPrimo paragrafo\r\n\r\n- a\r\n- b\r\n';
  assert.equal(roundTrip(windows), windows);
  const mixed = '# Titolo\r\n\r\nUno\ndue\r\n\r\nTre\n';
  assert.equal(roundTrip(mixed), mixed);

  const edited = edit(windows, (transaction, doc) => {
    transaction.insertText('!', blockStart(doc, 1) + 1 + doc.child(1).content.size);
    transaction.insert(transaction.doc.content.size, schema.nodes.bulletList.create(null, [
      schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text('x'))),
      schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text('y'))),
    ]));
  });
  assert.equal(edited, '# Titolo\r\n\r\nPrimo paragrafo!\r\n\r\n- a\r\n- b\r\n\r\n* x\r\n* y\r\n');
});

test('riscrive solo il blocco modificato e lascia identici gli altri', () => {
  const source = fs.readFileSync(path.join(root, 'tests/fixtures/documento.md'), 'utf8');
  const output = edit(source, (transaction, doc) => {
    const start = blockStart(doc, 1) + 1;
    transaction.addMark(start, start + 10, schema.marks.italic.create());
  });
  const before = source.split('\n');
  const after = output.split('\n');
  assert.equal(after.length, before.length);
  const changed = after.map((line, index) => (line === before[index] ? null : index)).filter((index) => index !== null);
  assert.deepEqual(changed, [2]);
  assert.equal(after[2], '*Benvenuto* nel **documento di prova**. Questo testo verifica il rendering Markdown completo.');
});

test('ripristina il testo originale quando una modifica viene annullata', () => {
  const output = edit(TRICKY, (transaction, doc) => {
    const start = blockStart(doc, 2) + 1;
    transaction.insertText('X', start);
    transaction.delete(start, start + 1);
  });
  assert.equal(output, TRICKY);
});

test('rappresenta i costrutti non modificabili come blocchi protetti', () => {
  const { doc } = bridge.parse(TRICKY);
  const kinds = [];
  doc.forEach((node) => { if (node.type.name === 'rawBlock') kinds.push(node.attrs.kind); });
  assert.deepEqual(kinds, ['frontmatter', 'markdown', 'html']);
  const inline = [];
  doc.descendants((node) => { if (node.type.name === 'rawInline') inline.push(node.attrs.source); });
  assert.deepEqual(inline, ['[^1]', '<kbd>', '</kbd>', '^[nota in linea]']);
  assert.equal(bridge.parse('[^a]: Nota').doc.firstChild.attrs.kind, 'footnote');
  assert.equal(bridge.parse('[a]: https://example.com').doc.firstChild.attrs.kind, 'reference');
});

test('rigenera tutti i costrutti in Markdown equivalente', () => {
  const output = regenerate(TRICKY);
  assert.equal(output, [
    '---',
    'title: Prova',
    '---',
    '',
    '# Titolo setext',
    '',
    'Paragrafo con *enfasi*, **forte** e un [link](https://example.com "Esempio") su due righe, una nota[^1] e <kbd>Ctrl</kbd>.',
    '',
    '[ref]: https://example.com "Esempio"',
    '',
    '[^1]: Testo della nota',
    '    su due righe.',
    '',
    '<div align="center">HTML</div>',
    '',
    '- uno',
    '- due',
    '',
    '* [ ] da fare',
    '* [x] fatto',
    '',
    '3. terzo',
    '4. quarto',
    '',
    '| Sinistra | Destra |',
    '| :-- | --: |',
    '| a \\| b | `c` |',
    '',
    '```',
    'codice indentato',
    '```',
    '',
    '```py title=demo',
    'print("ciao")',
    '```',
    '',
    '---',
    '',
    'https://example.com e <https://example.org/x> © ^[nota in linea]',
    '',
  ].join('\n'));
  // Il Markdown rigenerato descrive lo stesso documento ed è stabile.
  assert.ok(bridge.parse(output).doc.eq(bridge.parse(TRICKY).doc));
  assert.equal(regenerate(output), output);
});

test('serializza la formattazione applicata dalla barra degli strumenti', () => {
  const text = (value, ...marks) => schema.text(value, marks.map((name) => schema.marks[name].create()));
  const paragraph = (...content) => schema.nodes.paragraph.create(null, content);
  const cell = (type, value, align = null) => schema.nodes[type].create({ align }, paragraph(...(value ? [schema.text(value)] : [])));
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create({ level: 2 }, text('Titolo')),
    paragraph(text('normale '), text('grassetto', 'bold'), text(' '), text('corsivo', 'italic'), text(' '), text('barrato', 'strike'), text(' '), text('codice`x', 'code'),
      schema.nodes.hardBreak.create(), text('nuova riga')),
    paragraph(schema.text('sito', [schema.marks.link.create({ href: 'https://example.com/a b', title: 'T' })]), text(' '),
      schema.nodes.image.create({ src: 'img/foto (1).png', alt: 'Foto', title: null })),
    schema.nodes.blockquote.create(null, [paragraph(text('citazione')), schema.nodes.bulletList.create(null, [schema.nodes.listItem.create(null, paragraph(text('dentro')))])]),
    schema.nodes.orderedList.create({ start: 9, tight: true }, [
      schema.nodes.listItem.create(null, [paragraph(text('nove')), schema.nodes.codeBlock.create({ language: 'js' }, schema.text('let a;\n\nlet b;'))]),
      schema.nodes.listItem.create(null, paragraph(text('dieci'))),
    ]),
    schema.nodes.taskList.create({ tight: false }, [
      schema.nodes.taskItem.create({ checked: true }, paragraph(text('fatto'))),
      schema.nodes.taskItem.create({ checked: false }, paragraph()),
    ]),
    schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [cell('tableHeader', 'A', 'center'), cell('tableHeader', 'B')]),
      schema.nodes.tableRow.create(null, [cell('tableCell', 'x|y'), schema.nodes.tableCell.create(null, paragraph(text('uno'), schema.nodes.hardBreak.create(), text('due')))]),
      schema.nodes.tableRow.create(null, [cell('tableCell', '')]),
    ]),
    schema.nodes.horizontalRule.create(),
    paragraph(),
  ]);
  const output = bridge.serialize(doc, bridge.parse('').origin);
  assert.equal(output, [
    '## Titolo',
    '',
    'normale **grassetto** *corsivo* ~~barrato~~ `` codice`x ``\\',
    'nuova riga',
    '',
    '[sito](<https://example.com/a b> "T") ![Foto](<img/foto (1).png>)',
    '',
    '> citazione',
    '>',
    '> - dentro',
    '',
    '9.  nove',
    '    ```js',
    '    let a;',
    '    ',
    '    let b;',
    '    ```',
    '10. dieci',
    '',
    '- [x] fatto',
    '',
    '- [ ] ',
    '',
    '| A | B |',
    '| :-: | --- |',
    '| x\\|y | uno<br>due |',
    '|  |  |',
    '',
    '---',
    '',
  ].join('\n'));

  const reparsed = bridge.parse(output).doc;
  assert.equal(reparsed.child(4).attrs.start, 9);
  assert.equal(reparsed.child(4).firstChild.child(1).textContent, 'let a;\n\nlet b;');
  assert.equal(reparsed.child(5).type.name, 'taskList');
  assert.equal(reparsed.child(5).firstChild.attrs.checked, true);
  assert.equal(reparsed.child(6).firstChild.firstChild.attrs.align, 'center');
  assert.equal(reparsed.child(6).child(1).firstChild.textContent, 'x|y');
});

test('protegge il testo che verrebbe interpretato come Markdown', () => {
  const lines = ['# non un titolo', '- non un elenco', '1. non numerato', '2) nemmeno', '> non citazione', '*asterischi* e _trattini_ e `apici`',
    '<div> non HTML &amp; non entità', '[non](link) ![non](immagine)', '===', 'snake_case resta', '    non codice'];
  const doc = schema.nodes.doc.create(null, lines.map((line) => schema.nodes.paragraph.create(null, schema.text(line))));
  const output = bridge.serialize(doc, bridge.parse('').origin);
  const reparsed = bridge.parse(output).doc;
  assert.equal(reparsed.childCount, lines.length);
  reparsed.forEach((node, offset, index) => {
    assert.equal(node.type.name, 'paragraph', lines[index]);
    assert.equal(node.textContent, lines[index].trim(), lines[index]);
    node.forEach((child) => assert.deepEqual(child.marks, [], lines[index]));
  });
  assert.match(output, /snake_case resta/);
});

test('mantiene le caselle scritte a mano negli elenchi misti', () => {
  const source = '- normale\n- [ ] attività\n- [x] fatta\n';
  const { doc } = bridge.parse(source);
  assert.equal(doc.firstChild.type.name, 'bulletList');
  assert.equal(regenerate(source), source);
});

test('non fonde due elenchi adiacenti dello stesso tipo', () => {
  const output = edit('- a\n\ntesto\n\n- b\n', (transaction, doc) => {
    const start = blockStart(doc, 1);
    transaction.delete(start, start + doc.child(1).nodeSize);
  });
  assert.equal(bridge.parse(output).doc.childCount, 2);
  assert.equal(output, '- a\n\n* b\n');
});

test('riaggiunge le definizioni di collegamento annidate che una modifica farebbe perdere', () => {
  const source = '> Citazione\n>\n> [rif]: https://example.com "Titolo"\n\nUn [collegamento][rif] intatto.\n';
  assert.equal(roundTrip(source), source);
  const output = edit(source, (transaction) => transaction.insertText('!', 3));
  assert.match(output, /^> C!itazione\n\n/);
  assert.match(output, /Un \[collegamento\]\[rif\] intatto\.\n\n\[rif\]: https:\/\/example\.com "Titolo"\n$/);
  const link = bridge.parse(output).doc.child(1).child(1).marks[0];
  assert.equal(link.attrs.href, 'https://example.com');
});

test('ignora i paragrafi vuoti e gestisce il documento svuotato', () => {
  const output = edit('# Titolo\n\nTesto\n', (transaction) => {
    transaction.insert(transaction.doc.content.size, schema.nodes.paragraph.create());
    transaction.setSelection(TextSelection.atEnd(transaction.doc));
  });
  assert.equal(output, '# Titolo\n\nTesto\n');
  assert.equal(edit('# Titolo\n', (transaction) => transaction.delete(0, transaction.doc.content.size)), '');
});

test('l\'evidenziazione del codice in modifica usa le stesse classi della lettura', () => {
  const { highlighter, toTree } = require('../../src/renderer/editor/highlight');
  const tree = highlighter.highlight('js', 'const a = "<b>";');
  const keyword = tree.children.find((node) => node.type === 'element');
  assert.deepEqual(keyword.properties.className, ['hljs-keyword']);
  assert.equal(keyword.children[0].value, 'const');
  const flatten = (nodes) => nodes.map((node) => (node.type === 'text' ? node.value : flatten(node.children))).join('');
  assert.equal(flatten(tree.children), 'const a = "<b>";');
  assert.deepEqual(highlighter.highlightAuto('testo semplice').children, [{ type: 'text', value: 'testo semplice' }]);
  assert.equal(highlighter.registered('python'), true);
  assert.equal(highlighter.registered('linguaggio-inesistente'), false);
  assert.deepEqual(toTree('a &amp; <span class="x y">b</span>').children.map((node) => node.type), ['text', 'element']);
});
