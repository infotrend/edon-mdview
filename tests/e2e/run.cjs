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
fs.cpSync(path.join(root, 'tests', 'fixtures'), temp, { recursive: true });

let application;
const pageErrors = [];

async function run() {
  application = await electron.launch({
    args: ['.', documentPath],
    cwd: root,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
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

  await page.locator('#shortcuts-button').click();
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
  await page.locator('#shortcuts-close').click();
  await expect(page.locator('#shortcuts-dialog')).not.toBeVisible();

  const expectedLogoBounds = [
    { x: 7, y: 21, width: 150, height: 180 },
    { x: 74, y: 113, width: 175, height: 27 },
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
      interface: [...document.querySelectorAll('#edon-mark path')].map((pathElement) => {
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
