const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdview-e2e-'));
const documentPath = path.join(temp, 'documento.md');
const secondPath = path.join(temp, 'secondo.md');
const exportPath = path.join(temp, 'esportato.html');
const editPath = path.join(temp, 'modifica.md');
const copyPath = path.join(temp, 'copia.md');
fs.cpSync(path.join(root, 'tests', 'fixtures'), temp, { recursive: true });

const EDIT_SOURCE = [
  '# Documento di prova',
  '',
  'Primo paragrafo con una parola importante e una da inclinare.',
  '',
  'Questo diventa un titolo',
  '',
  'Voce da elencare',
  '',
  '- [ ] Attività aperta',
  '- [x] Attività chiusa',
  '',
  '| Nome | Valore |',
  '|------|-------:|',
  '| alfa | 1 |',
  '',
  'Testo con nota[^1] e <kbd>Ctrl</kbd> intatti.',
  '',
  '[^1]: La nota resta com\'è.',
  '',
  '<details><summary>HTML</summary>Resta com\'è.</details>',
  '',
  'Ultimo   paragrafo _non toccato_.',
  '',
].join('\n');

// Only the blocks edited in the test are rewritten; every other line is byte for byte the original.
const EDIT_RESULT = [
  '# Documento di prova',
  '',
  '[Primo](https://example.com) paragrafo con una parola **importante** e una da *inclinare*.',
  '',
  '## Questo diventa un titolo',
  '',
  '- Voce da elencare',
  '',
  '* [x] Attività aperta',
  '* [x] Attività chiusa',
  '',
  '| Nome | Valore |',
  '| --- | --: |',
  '| alfa | 1 |',
  '| beta | 2 |',
  '',
  'Testo con nota[^1] e <kbd>Ctrl</kbd> intatti.',
  '',
  '[^1]: La nota resta com\'è.',
  '',
  '<details><summary>HTML</summary>Resta com\'è.</details>',
  '',
  'Ultimo   paragrafo _non toccato_.',
  '',
].join('\n');

let application;
const pageErrors = [];
const read = (file) => fs.readFileSync(file, 'utf8');
const editor = '.editor-surface';

/** Selects a piece of text inside the editor the way a user would with the mouse. */
async function selectText(page, text) {
  await page.evaluate(({ selector, needle }) => {
    const surface = document.querySelector(selector);
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const index = walker.currentNode.nodeValue.indexOf(needle);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, index);
      range.setEnd(walker.currentNode, index + needle.length);
      surface.focus();
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`Testo non trovato nell'editor: ${needle}`);
  }, { selector: editor, needle: text });
  await page.waitForTimeout(120);
}

async function answerUnsavedPrompt(response) {
  await application.evaluate(({ dialog }, value) => {
    dialog.showMessageBox = async () => ({ response: value });
  }, response);
}

async function openThroughDialog(page, filePath) {
  await application.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] });
  }, filePath);
  await page.locator('#open-button').click();
}

/** The mode toggle ignores a second request within 300 ms (the shortcut can arrive twice). */
async function toggleEditMode(page) {
  await page.waitForTimeout(350);
  await page.locator('#edit-button').click();
}

/** Clicks inside the editor and lets it pick up the caret position, as it does a few milliseconds after a real click. */
async function placeCursor(page, locator) {
  await locator.click();
  await page.waitForTimeout(200);
}

async function typeAtEnd(page, locator, text) {
  await placeCursor(page, locator);
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

async function run() {
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', EDON_MDVIEW_USER_DATA: path.join(temp, 'profilo') };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    args: ['.', documentPath],
    cwd: root,
    env,
    timeout: 45000,
  });
  const page = await application.firstWindow({ timeout: 30000 });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await expect(page.locator('#content h1').first()).toHaveText('Guida Markdown', { timeout: 20000 });
  await expect(page).toHaveTitle('documento.md — EDON MDView');
  await expect(page.locator('#toc a')).toHaveCount(4);
  await expect(page.locator('#content table')).toBeVisible();
  await expect(page.locator('#content input[type="checkbox"]').first()).toBeChecked();
  await expect(page.locator('#content pre code .hljs-keyword')).toHaveText('const');
  await expect(page.locator('#content h2[id="funzionalità-2"]')).toBeVisible();
  await expect(page.locator('#content img[src^="mdview:"]')).toHaveAttribute('src', /path=/);
  await expect(page.locator('#content script')).toHaveCount(0);
  await expect(page.locator('#content [onerror]')).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__markdownXss), undefined);
  console.log('OK rendering, indice, immagini locali e sanificazione');

  await page.locator('#search-button').click();
  await page.locator('#search-input').fill('Serendipità');
  await expect(page.locator('#content mark.search-highlight')).toHaveCount(1);
  await expect(page.locator('#search-count')).toHaveText('1 di 1');
  await page.locator('#search-close').click();
  await expect(page.locator('#content mark')).toHaveCount(0);
  console.log('OK ricerca e pulizia evidenziazione');

  const initialTheme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#theme-button').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme === 'dark' ? 'light' : 'dark');
  await page.locator('#sidebar-button').click();
  await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
  await page.locator('#sidebar-button').click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);
  await page.keyboard.press('Control+-');
  await expect(page.locator('#zoom-level')).toHaveText('90%');
  await page.keyboard.press('Control+0');
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  console.log('OK tema, indice laterale e zoom');

  await application.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  }, exportPath);
  await page.locator('#export-button').click();
  await expect.poll(() => fs.existsSync(exportPath), { timeout: 15000 }).toBe(true);
  const exported = fs.readFileSync(exportPath, 'utf8');
  assert.match(exported, /<title>documento<\/title>/);
  assert.match(exported, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(exported, /<script/i);
  assert.doesNotMatch(exported, /__markdownXss/);
  console.log('OK esportazione HTML autonoma con immagine incorporata');

  await page.locator('#content a[href="secondo.md"]').click();
  await expect(page.locator('#content h1')).toHaveText('Secondo documento');
  await expect(page).toHaveTitle('secondo.md — EDON MDView');
  console.log('OK navigazione fra documenti locali');

  await application.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, documentPath);
  await page.locator('#open-button').click();
  await expect(page.locator('#content h1')).toHaveText('Guida Markdown');
  console.log('OK comando Apri e caricamento da finestra di dialogo');

  await page.locator('#viewer').evaluate((viewer) => { viewer.scrollTop = viewer.scrollHeight; });
  const marker = `\n\n## Aggiornamento ${Date.now()}\n\nContenuto ricaricato automaticamente.\n`;
  fs.appendFileSync(documentPath, marker, 'utf8');
  await expect(page.locator('#content')).toContainText('Contenuto ricaricato automaticamente.', { timeout: 15000 });
  assert.ok(await page.locator('#viewer').evaluate((viewer) => viewer.scrollTop > 0));
  console.log('OK ricaricamento automatico con posizione di lettura preservata');

  // ---- Modalità modifica: nessuna modifica, nessuna differenza sul file.
  const untouched = read(documentPath);
  await toggleEditMode(page);
  await expect(page.locator('#edit-toolbar')).toBeVisible();
  await expect(page.locator(editor)).toBeVisible();
  await expect(page.locator('#content')).toBeHidden();
  await expect(page.locator('#edit-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`${editor} h1`).first()).toHaveText('Guida Markdown');
  await expect(page.locator('#toc a')).toHaveCount(5);
  await expect(page.locator(`${editor} .raw-block[data-kind="html"]`)).toHaveCount(2);
  await expect(page.locator(`${editor} .raw-block[data-kind="footnote"]`)).toContainText('[^nota]: Le note sono supportate.');
  await expect(page.locator(`${editor} .raw-inline[data-raw-inline="footnote"]`)).toHaveText('nota');
  await expect(page.locator(`${editor} img[src^="mdview:"]`)).toHaveCount(1);
  await expect(page.locator(`${editor} pre code .hljs-keyword`)).toHaveText('const');
  await expect(page.locator(`${editor} script`)).toHaveCount(0);
  await expect(page.locator(`${editor} [onerror]`)).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__markdownXss), undefined);
  await expect(page).toHaveTitle('documento.md — EDON MDView');
  await expect(page.locator('#save-button')).toBeDisabled();
  await page.keyboard.press('Control+s');
  await toggleEditMode(page);
  await expect(page.locator('#edit-toolbar')).toBeHidden();
  await expect(page.locator('#content h1').first()).toHaveText('Guida Markdown');
  assert.equal(read(documentPath), untouched);
  console.log('OK modalità modifica senza modifiche: file identico, contenuto sanificato e blocchi protetti');

  // ---- Formattazione dalla barra e da tastiera, poi salvataggio.
  fs.writeFileSync(editPath, EDIT_SOURCE, 'utf8');
  await openThroughDialog(page, editPath);
  await expect(page.locator('#content h1')).toHaveText('Documento di prova');
  await toggleEditMode(page);
  await expect(page.locator(editor)).toBeVisible();

  await selectText(page, 'importante');
  await page.locator('[data-command="bold"]').click();
  await expect(page.locator(`${editor} strong`)).toHaveText('importante');
  await expect(page.locator('[data-command="bold"]')).toHaveClass(/active/);
  await selectText(page, 'inclinare');
  await page.keyboard.press('Control+i');
  await expect(page.locator(`${editor} em`)).toHaveText(['inclinare', 'non toccato']);
  await selectText(page, 'Primo');
  await page.locator('[data-command="link"]').click();
  await expect(page.locator('#link-dialog')).toBeVisible();
  await page.locator('#link-url').fill('https://example.com');
  await page.locator('#link-apply').click();
  await expect(page.locator(`${editor} a[href="https://example.com"]`)).toHaveText('Primo');

  await placeCursor(page, page.locator(`${editor} p`, { hasText: 'Questo diventa un titolo' }));
  await page.locator('#block-type').selectOption('2');
  await expect(page.locator(`${editor} h2`)).toHaveText('Questo diventa un titolo');
  await expect(page.locator('#toc a')).toHaveCount(2);

  await placeCursor(page, page.locator(`${editor} p`, { hasText: 'Voce da elencare' }));
  await page.locator('[data-command="bulletList"]').click();
  await expect(page.locator(`${editor} ul:not([data-type]) li`)).toHaveText('Voce da elencare');

  await page.locator(`${editor} ul[data-type="taskList"] input[type="checkbox"]`).first().click();
  await expect(page.locator(`${editor} ul[data-type="taskList"] input[type="checkbox"]`).first()).toBeChecked();

  await expect(page.locator('#table-tools')).toBeHidden();
  await placeCursor(page, page.locator(`${editor} td`, { hasText: 'alfa' }));
  await expect(page.locator('#table-tools')).toBeVisible();
  await page.locator('[data-command="rowAfter"]').click();
  await expect(page.locator(`${editor} table tr`)).toHaveCount(3);
  await placeCursor(page, page.locator(`${editor} table tr`).nth(2).locator('td').first());
  await page.keyboard.type('beta');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2');
  await page.locator('[data-command="columnAfter"]').click();
  await expect(page.locator(`${editor} table tr`).first().locator('th')).toHaveCount(3);
  await page.keyboard.press('Tab');
  await page.locator('[data-command="columnDelete"]').click();
  await expect(page.locator(`${editor} table tr`).first().locator('th')).toHaveCount(2);

  await expect(page).toHaveTitle('● modifica.md — EDON MDView');
  await expect(page.locator('#status-text')).toHaveText('Modifiche non salvate');
  await expect(page.locator('#dirty-indicator')).toBeVisible();
  assert.equal(read(editPath), EDIT_SOURCE);

  await placeCursor(page, page.locator(`${editor} li`, { hasText: 'Voce da elencare' }));
  await page.keyboard.press('End');
  await page.evaluate((selector) => { document.querySelector(selector).savedProbe = true; }, editor);
  await page.keyboard.press('Control+s');
  await expect.poll(() => read(editPath), { timeout: 15000 }).toBe(EDIT_RESULT);
  await expect(page).toHaveTitle('modifica.md — EDON MDView');
  await expect(page.locator('#status-text')).toHaveText(/^Salvato alle \d{2}:\d{2}$/);
  await expect(page.locator('#dirty-indicator')).toBeHidden();
  console.log('OK formattazione visiva e salvataggio: su disco il Markdown atteso, blocchi non toccati identici');

  // Il salvataggio dell'app non deve tornare indietro come ricaricamento: stesso editor, stesso cursore.
  await page.waitForTimeout(900);
  await expect(page.locator('.toast', { hasText: 'Documento aggiornato' })).toHaveCount(0);
  assert.equal(await page.evaluate((selector) => document.querySelector(selector).savedProbe, editor), true);
  await page.keyboard.type(' ancora');
  await expect(page.locator(`${editor} ul:not([data-type]) li`)).toHaveText('Voce da elencare ancora');
  await expect(page).toHaveTitle('● modifica.md — EDON MDView');
  console.log('OK il salvataggio non innesca il ricaricamento e mantiene cursore e stato');

  // ---- Il file cambia su disco mentre ci sono modifiche non salvate: sceglie l'utente.
  const external = `${EDIT_RESULT}\nAggiunta esterna.\n`;
  fs.writeFileSync(editPath, external, 'utf8');
  await expect(page.locator('#conflict-banner')).toBeVisible({ timeout: 15000 });
  await expect(page.locator(`${editor} ul:not([data-type]) li`)).toHaveText('Voce da elencare ancora');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(500);
  assert.equal(read(editPath), external);
  await page.locator('#conflict-reload').click();
  await expect(page.locator('#conflict-banner')).toBeHidden();
  await expect(page.locator(`${editor} p`, { hasText: 'Aggiunta esterna.' })).toBeVisible();
  await expect(page.locator(`${editor} ul:not([data-type]) li`)).toHaveText('Voce da elencare');
  await expect(page).toHaveTitle('modifica.md — EDON MDView');

  await typeAtEnd(page, page.locator(`${editor} p`, { hasText: 'Aggiunta esterna.' }), ' Mia.');
  fs.writeFileSync(editPath, `${EDIT_RESULT}\nSeconda esterna.\n`, 'utf8');
  await expect(page.locator('#conflict-banner')).toBeVisible({ timeout: 15000 });
  await page.locator('#conflict-keep').click();
  await expect(page.locator('#conflict-banner')).toBeHidden();
  await expect(page).toHaveTitle('● modifica.md — EDON MDView');
  await page.keyboard.press('Control+s');
  await expect.poll(() => read(editPath), { timeout: 15000 }).toBe(`${EDIT_RESULT}\nAggiunta esterna. Mia.\n`);
  await expect(page).toHaveTitle('modifica.md — EDON MDView');

  fs.writeFileSync(editPath, '# Nuovo\n\nContenuto esterno.\n', 'utf8');
  await expect(page.locator(`${editor} p`, { hasText: 'Contenuto esterno.' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#conflict-banner')).toBeHidden();
  await expect(page).toHaveTitle('modifica.md — EDON MDView');
  console.log('OK modifiche esterne: scelta esplicita con lavoro non salvato, aggiornamento diretto senza');

  // ---- Conferma prima di perdere modifiche: uscita dalla modalità, altro documento, chiusura.
  await typeAtEnd(page, page.locator(`${editor} p`, { hasText: 'Contenuto esterno.' }), ' Bozza.');
  await answerUnsavedPrompt(2);
  await toggleEditMode(page);
  await page.waitForTimeout(400);
  await expect(page.locator('#edit-toolbar')).toBeVisible();
  await openThroughDialog(page, secondPath);
  await page.waitForTimeout(500);
  await expect(page).toHaveTitle('● modifica.md — EDON MDView');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(500);
  await expect(page.locator(`${editor} p`, { hasText: 'Contenuto esterno. Bozza.' })).toBeVisible();

  await answerUnsavedPrompt(1);
  await toggleEditMode(page);
  await expect(page.locator('#edit-toolbar')).toBeHidden();
  await expect(page.locator('#content')).toContainText('Contenuto esterno.');
  await expect(page.locator('#content')).not.toContainText('Bozza');
  assert.equal(read(editPath), '# Nuovo\n\nContenuto esterno.\n');

  await toggleEditMode(page);
  await typeAtEnd(page, page.locator(`${editor} p`, { hasText: 'Contenuto esterno.' }), ' Salvato uscendo.');
  await answerUnsavedPrompt(0);
  await toggleEditMode(page);
  await expect(page.locator('#edit-toolbar')).toBeHidden();
  await expect(page.locator('#content')).toContainText('Contenuto esterno. Salvato uscendo.');
  assert.equal(read(editPath), '# Nuovo\n\nContenuto esterno. Salvato uscendo.\n');

  await toggleEditMode(page);
  await typeAtEnd(page, page.locator(`${editor} p`, { hasText: 'Salvato uscendo.' }), ' Da scartare.');
  await answerUnsavedPrompt(1);
  await openThroughDialog(page, secondPath);
  await expect(page.locator('#content h1')).toHaveText('Secondo documento');
  await expect(page.locator('#edit-toolbar')).toBeHidden();
  await expect(page).toHaveTitle('secondo.md — EDON MDView');
  assert.equal(read(editPath), '# Nuovo\n\nContenuto esterno. Salvato uscendo.\n');
  console.log('OK conferme con modifiche non salvate: annulla, non salvare e salva');

  // ---- Salva con nome: il percorso lo sceglie l'utente nella finestra di sistema.
  const secondSource = read(secondPath);
  await toggleEditMode(page);
  await application.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  }, copyPath);
  await page.locator('#save-as-button').click();
  await expect.poll(() => fs.existsSync(copyPath) && read(copyPath), { timeout: 15000 }).toBe(secondSource);
  await expect(page).toHaveTitle('copia.md — EDON MDView');
  await typeAtEnd(page, page.locator(`${editor} h1`), ' in copia');
  await page.keyboard.press('Control+s');
  await expect.poll(() => read(copyPath), { timeout: 15000 }).toMatch(/^# Secondo documento in copia$/m);
  assert.equal(read(secondPath), secondSource);
  await expect(page).toHaveTitle('copia.md — EDON MDView');
  await toggleEditMode(page);
  await expect(page.locator('#content h1')).toHaveText('Secondo documento in copia');
  console.log('OK Salva con nome: nuovo file, originale intatto, salvataggi successivi sulla copia');

  await page.locator('#shortcuts-button').click();
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
  await expect(page.locator('#shortcuts-dialog')).toContainText('Salva con nome');
  await expect(page.locator('#shortcuts-dialog')).toContainText('Grassetto');
  await page.locator('#shortcuts-close').click();
  await expect(page.locator('#shortcuts-dialog')).not.toBeVisible();

  const expectedLogoBounds = [
    { x: 8, y: 53, width: 150, height: 150 },
    { x: 75, y: 113, width: 173, height: 30 },
  ];
  const logoSvg = fs.readFileSync(path.join(root, 'build', 'edon-logo.svg'), 'utf8');
  const iconSvg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
  const logoGeometry = await page.evaluate(({ standalone, icon }) => {
    const measure = (markup) => {
      const documentSvg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
      const element = document.importNode(documentSvg, true);
      element.style.cssText = 'position:absolute;visibility:hidden;width:256px;height:256px';
      document.body.append(element);
      const bounds = [...element.querySelectorAll('path')].slice(0, 2).map((pathElement) => {
        const box = pathElement.getBBox();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
      element.remove();
      return bounds;
    };
    return {
      interface: [...document.querySelectorAll('#edon-mark path:not(.edon-md)')].map((pathElement) => {
        const box = pathElement.getBBox();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
      standalone: measure(standalone),
      icon: measure(icon),
    };
  }, { standalone: logoSvg, icon: iconSvg });
  assert.deepEqual(logoGeometry.interface, expectedLogoBounds);
  assert.deepEqual(logoGeometry.standalone, expectedLogoBounds);
  assert.deepEqual(logoGeometry.icon, expectedLogoBounds);
  console.log('OK proporzioni originali del logo nella finestra, nel SVG e nell’icona');

  assert.deepEqual(pageErrors, [], `Errori nella pagina: ${pageErrors.join('; ')}`);
  console.log('OK nessun errore JavaScript nella finestra');
}

run()
  .then(() => console.log('Tutti i test end-to-end sono superati.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (application) await application.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
