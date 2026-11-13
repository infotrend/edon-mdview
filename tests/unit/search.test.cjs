const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { DocumentSearch } = require('../../src/renderer/search');

function setup(html) {
  const window = new JSDOM(`<main>${html}</main>`, { pretendToBeVisual: true }).window;
  global.document = window.document;
  global.NodeFilter = window.NodeFilter;
  window.document.createElement('mark').constructor.prototype.scrollIntoView = function () {};
  return new DocumentSearch(window.document.querySelector('main'));
}

test('trova testo in nodi diversi e naviga ciclicamente tra i risultati', () => {
  const search = setup('<p>Markdown e <strong>markdown</strong> ancora</p>');
  assert.equal(search.search('markdown').length, 2);
  assert.equal(search.current, 0);
  search.activate(1);
  assert.equal(search.matches[1].classList.contains('current'), true);
  search.activate(2);
  assert.equal(search.current, 0);
  search.clear();
  assert.equal(search.container.querySelectorAll('mark').length, 0);
  assert.match(search.container.textContent, /Markdown e markdown ancora/);
});

test('ignora nodi non testuali e query assenti', () => {
  const search = setup('<p>Contenuto</p><script>Contenuto</script>');
  assert.equal(search.search('').length, 0);
  assert.equal(search.search('assente').length, 0);
  assert.equal(search.search('Contenuto').length, 1);
});
