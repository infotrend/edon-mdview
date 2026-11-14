const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { DICTIONARIES, LANGUAGES, resolveLanguage, languageForSystem, translate } = require('../../src/i18n');
const about = require('../../src/about');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

function sourceFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return relative === 'src/i18n' ? [] : sourceFiles(relative);
    return /\.(js|html)$/.test(entry.name) ? [relative] : [];
  });
}

test('un sistema in italiano parte in italiano, ogni altro in inglese', () => {
  for (const system of ['it', 'it-IT', 'it-CH', 'IT-it', 'it_IT']) assert.equal(languageForSystem(system), 'it', system);
  for (const system of ['en-US', 'en-GB', 'de-DE', 'fr', 'es-ES', 'ita', 'lit', '', undefined, null]) {
    assert.equal(languageForSystem(system), 'en', String(system));
  }
  assert.equal(resolveLanguage({ system: 'it-IT' }), 'it');
  assert.equal(resolveLanguage({ system: 'de-DE' }), 'en');
  assert.equal(resolveLanguage(), 'en');
});

test('la lingua scelta a mano prevale su quella del sistema', () => {
  assert.equal(resolveLanguage({ saved: 'en', system: 'it-IT' }), 'en');
  assert.equal(resolveLanguage({ saved: 'it', system: 'en-US' }), 'it');
  for (const saved of ['de', 'IT', '', 42, null, {}]) {
    assert.equal(resolveLanguage({ saved, system: 'it-IT' }), 'it', `scelta non valida: ${JSON.stringify(saved)}`);
    assert.equal(resolveLanguage({ saved, system: 'en-US' }), 'en', `scelta non valida: ${JSON.stringify(saved)}`);
  }
});

test('i dizionari delle due lingue hanno le stesse chiavi e gli stessi segnaposto', () => {
  assert.deepEqual(LANGUAGES, ['it', 'en']);
  const italian = DICTIONARIES.it;
  const english = DICTIONARIES.en;
  assert.deepEqual(Object.keys(english).sort(), Object.keys(italian).sort());
  for (const key of Object.keys(italian)) {
    for (const dictionary of [italian, english]) {
      assert.equal(typeof dictionary[key], 'string', key);
      assert.ok(dictionary[key].trim(), `testo vuoto: ${key}`);
    }
    assert.deepEqual(placeholders(english[key]), placeholders(italian[key]), `segnaposto diversi: ${key}`);
  }
});

test('la traduzione sostituisce i segnaposto e non inventa testi', () => {
  assert.equal(translate('it', 'search.position', { position: 2, count: 5 }), '2 di 5');
  assert.equal(translate('en', 'search.position', { position: 2, count: 5 }), '2 of 5');
  assert.equal(translate('it', 'menu.help.about'), 'Informazioni');
  assert.equal(translate('en', 'menu.help.about'), 'About');
  assert.equal(translate('it', 'menu.view.language.en'), 'Inglese');
  assert.equal(translate('en', 'menu.view.language.it'), 'Italian');
  assert.equal(translate('xx', 'menu.file.save'), 'Save');
  assert.equal(translate('it', 'chiave.inesistente'), 'chiave.inesistente');
});

test('ogni chiave usata dal codice e dalla pagina esiste, e ogni chiave del dizionario è usata', () => {
  const files = sourceFiles('src');
  const sources = Object.fromEntries(files.map((file) => [file, read(file)]));
  const known = new Set(Object.keys(DICTIONARIES.it));
  const used = new Set();
  const collect = (key, file) => {
    assert.ok(known.has(key), `${file}: chiave «${key}» assente dai dizionari`);
    used.add(key);
  };
  for (const [file, source] of Object.entries(sources)) {
    if (file.endsWith('.html')) {
      for (const match of source.matchAll(/data-i18n(?:-title|-label|-placeholder)?="([^"]+)"/g)) collect(match[1], file);
    } else {
      for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) collect(match[1], file);
      // Keys chosen by a condition or listed in a table are plain quoted strings.
      for (const match of source.matchAll(/'([a-z][A-Za-z]*(?:\.[A-Za-z]+)+)'/g)) if (known.has(match[1])) used.add(match[1]);
    }
  }
  // The language names are looked up by language code: `menu.view.language.${code}`.
  for (const language of LANGUAGES) used.add(`menu.view.language.${language}`);
  assert.deepEqual([...known].filter((key) => !used.has(key)), [], 'chiavi mai usate');
});

test('la pagina non contiene testi fissi: tutto il testo visibile arriva dal dizionario', () => {
  const { document } = new JSDOM(read('src/renderer/index.html')).window;
  // Key caps, symbols and numbers are the same in every language.
  for (const element of document.querySelectorAll('svg, script, style, kbd, title')) element.remove();
  const walker = document.createTreeWalker(document.body, 4);
  const literals = [];
  while (walker.nextNode()) if (/\p{L}{2,}/u.test(walker.currentNode.nodeValue)) literals.push(walker.currentNode.nodeValue.trim());
  assert.deepEqual(literals, []);
  for (const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
    assert.equal(document.querySelectorAll(`body [${attribute}]`).length, 0, `attributo ${attribute} scritto nella pagina`);
  }
});

test('la pagina tradotta riempie testi e attributi senza toccare il documento aperto', () => {
  const dom = new JSDOM(`<body>
    <button id="open" data-i18n-title="top.open.title"><span data-i18n="top.open"></span></button>
    <input id="search" data-i18n-placeholder="search.placeholder" data-i18n-label="search.input">
    <option id="heading" data-i18n="toolbar.heading" data-i18n-params='{"level":3}'></option>
    <article id="content"><span id="foreign" data-i18n="menu.file.quit" data-i18n-title="menu.file.quit">testo del documento</span></article>
  </body>`);
  const { document } = dom.window;
  const i18n = require('../../src/renderer/i18n');
  const snapshot = () => ({
    open: document.querySelector('#open span').textContent,
    title: document.querySelector('#open').getAttribute('title'),
    placeholder: document.querySelector('#search').getAttribute('placeholder'),
    label: document.querySelector('#search').getAttribute('aria-label'),
    heading: document.querySelector('#heading').textContent,
  });

  i18n.setLanguage('it');
  i18n.applyTranslations(document, '#content');
  assert.deepEqual(snapshot(), { open: 'Apri', title: 'Apri un documento (Ctrl+O)', placeholder: 'Cerca nel documento…', label: 'Testo da cercare', heading: 'Titolo 3' });
  i18n.setLanguage('en');
  i18n.applyTranslations(document, '#content');
  assert.deepEqual(snapshot(), { open: 'Open', title: 'Open a document (Ctrl+O)', placeholder: 'Find in document…', label: 'Text to find', heading: 'Heading 3' });
  assert.equal(i18n.locale(), 'en-US');
  assert.equal(document.querySelector('#foreign').textContent, 'testo del documento');
  assert.equal(document.querySelector('#foreign').hasAttribute('title'), false);
  assert.equal(i18n.setLanguage('de'), 'en');
});

test('la finestra Informazioni mostra INFOTREND SRL, il sito e non più «Sviluppato da»', () => {
  assert.equal(about.DEVELOPER, 'INFOTREND SRL');
  assert.equal(about.WEBSITE_URL, 'https://edon.systems');
  for (const language of LANGUAGES) {
    for (const [key, text] of Object.entries(DICTIONARIES[language])) {
      assert.doesNotMatch(text, /sviluppato da|developed by/i, `${language}: ${key}`);
      assert.doesNotMatch(text, /Informazioni su|About EDON/i, `${language}: ${key}`);
    }
  }
});

test('il sito si apre solo dal processo principale e solo a quell\'indirizzo', () => {
  const main = read('src/main.js');
  const preload = read('src/preload.js');
  assert.match(main, /ipcMain\.handle\('app:open-website', \(\) => shell\.openExternal\(WEBSITE_URL\)\)/);
  assert.match(preload, /openWebsite: \(\) => ipcRenderer\.invoke\('app:open-website'\)/);
  assert.doesNotMatch(preload, /openExternal/);
});

test('i ringraziamenti riportano dipendenze reali del progetto con la licenza dichiarata dal pacchetto', () => {
  const packageJson = JSON.parse(read('package.json'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  assert.ok(about.CREDITS.length >= 8);
  assert.equal(new Set(about.CREDITS.map((credit) => credit.name)).size, about.CREDITS.length);
  for (const credit of about.CREDITS) {
    assert.ok(Object.hasOwn(dependencies, credit.package), `${credit.package} non è una dipendenza del progetto`);
    const declared = JSON.parse(read(`node_modules/${credit.package}/package.json`)).license;
    assert.equal(credit.license, String(declared).replace(/^\((.*)\)$/, '$1'), `licenza di ${credit.package}`);
  }
  for (const name of ['electron', 'esbuild', 'markdown-it', 'dompurify', 'highlight.js', '@tiptap/core']) {
    assert.ok(about.CREDITS.some((credit) => credit.package === name), `manca ${name}`);
  }
});

test('la politica di sicurezza della pagina è invariata', () => {
  const html = read('src/renderer/index.html');
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob: https: http: mdview:; font-src \'self\' data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'));
});
