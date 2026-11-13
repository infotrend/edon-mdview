const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const { createMarkdownRenderer, slugify } = require('../../src/renderer/markdown');

function render(source) {
  const window = new JSDOM('<!doctype html>').window;
  return createMarkdownRenderer(createDOMPurify(window))(source);
}

test('renderizza titoli con ancore Unicode e identificatori unici', () => {
  const html = render('# Ciao mondo\n\n## Ciao mondo\n\n## Ciao mondo');
  assert.match(html, /id="ciao-mondo"/);
  assert.match(html, /id="ciao-mondo-2"/);
  assert.match(html, /id="ciao-mondo-3"/);
  assert.equal(slugify('  Funzionalità & test  '), 'funzionalità--test');
});

test('supporta tabelle, attività, note e codice evidenziato', () => {
  const html = render('| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] Fatto\n- [ ] Da fare\n\nNota[^1]\n\n[^1]: Dettaglio\n\n```js\nconst x = 42;\n```');
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked/);
  assert.match(html, /disabled/);
  assert.match(html, /footnotes/);
  assert.match(html, /hljs-keyword/);
});

test('mantiene HTML sicuro ma elimina script, moduli e gestori eventi', () => {
  const html = render('<div><strong>OK</strong><script>window.hacked=true</script><form><input value="x"></form><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">clic</a></div>');
  assert.match(html, /<strong>OK<\/strong>/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<form/);
  assert.doesNotMatch(html, /onerror/);
  assert.doesNotMatch(html, /javascript:/);
});

test('consenta immagini con protocollo interno ma non iframe', () => {
  const html = render('![Locale](mdview://local/resource?path=C%3A%5Ctest%5Ca.png)\n\n<iframe src="https://example.com"></iframe>');
  assert.match(html, /src="mdview:/);
  assert.doesNotMatch(html, /<iframe/);
});

test('trasforma automaticamente gli URL e usa tipografia leggibile', () => {
  const html = render('Visita https://example.com -- subito');
  assert.match(html, /<a href="https:\/\/example.com">/);
  assert.match(html, /–/);
});
