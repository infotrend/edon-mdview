const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('il prodotto espone nome, sviluppatore e licenza EDON corretti', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.productName, 'EDON MDView');
  assert.equal(packageJson.author.name, 'INFOTREND SRL');
  assert.equal(packageJson.license, 'FSL-1.1-MIT');
  assert.equal(packageJson.build.productName, 'EDON MDView');
  assert.equal(packageJson.build.nsis.shortcutName, 'EDON MDView');
  assert.equal(packageJson.build.nsis.license, 'LICENSE');
  assert.ok(packageJson.build.files.includes('LICENSE'));
});

test('la licenza FSL identifica INFOTREND SRL e la conversione MIT', () => {
  const license = read('LICENSE');
  assert.match(license, /Functional Source License, Version 1\.1, MIT Future License/);
  assert.match(license, /Copyright 2026 INFOTREND SRL/);
  assert.match(license, /second anniversary/);
});

test('la finestra usa il logo EDON accessibile e il nuovo nome', () => {
  const html = read('src/renderer/index.html');
  assert.match(html, /EDON MDView/);
  assert.match(html, /id="edon-mark"/);
  assert.match(html, /aria-hidden="true" class="edon-logo"/);
  assert.doesNotMatch(html, /M<span>↓<\/span>/);
  const main = read('src/main.js');
  assert.match(main, /INFOTREND SRL/);
  assert.match(main, /FSL-1\.1-MIT/);
});

test('le risorse vettoriali aggiungono il badge MD', () => {
  assert.match(read('build/icon.svg'), />MD<\/text>/);
});
