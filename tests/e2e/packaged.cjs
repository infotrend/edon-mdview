const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const executablePath = path.resolve(process.argv[2] || 'release/win-unpacked/EDON MDView.exe');
const root = path.resolve(__dirname, '..', '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdview-packaged-'));
const documentPath = path.join(temp, 'documento.md');
fs.cpSync(path.join(root, 'tests', 'fixtures'), temp, { recursive: true });

let application;
async function run() {
  // Own profile: the single-instance lock must not hand the test document to a copy the user has open.
  const env = { ...process.env, EDON_MDVIEW_USER_DATA: path.join(temp, 'profilo') };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath,
    args: [documentPath],
    cwd: temp,
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow({ timeout: 45000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('#content h1').first()).toHaveText('Guida Markdown', { timeout: 30000 });
  await expect(page.locator('#toc a')).toHaveCount(4);
  await expect.poll(() => page.locator('#content img[alt="Logo locale"]').evaluate((image) => image.naturalWidth)).toBe(240);

  // The editor is bundled too: it must mount, edit and save inside the packaged app.
  const untouched = fs.readFileSync(documentPath, 'utf8');
  await page.locator('#edit-button').click();
  await expect(page.locator('#edit-toolbar')).toBeVisible();
  await expect(page.locator('.editor-surface h1').first()).toHaveText('Guida Markdown');
  await page.locator('.editor-surface h1').first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.type(' modificata');
  await expect(page).toHaveTitle('● documento.md — EDON MDView');
  await page.keyboard.press('Control+s');
  await expect.poll(() => fs.readFileSync(documentPath, 'utf8'), { timeout: 15000 }).toBe(untouched.replace('# Guida Markdown', '# Guida Markdown modificata'));
  await expect(page).toHaveTitle('documento.md — EDON MDView');
  await page.waitForTimeout(350);
  await page.locator('#edit-button').click();
  await expect(page.locator('#edit-toolbar')).toBeHidden();
  await expect(page.locator('#content h1').first()).toHaveText('Guida Markdown modificata');

  await page.locator('#content a[href="secondo.md"]').click();
  await expect(page.locator('#content h1')).toHaveText('Secondo documento');
  assert.deepEqual(errors, []);
  console.log(`Pacchetto verificato: ${executablePath}`);
  console.log('OK avvio, rendering, protocollo immagini, modifica con salvataggio e navigazione nell’eseguibile pacchettizzato');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (application) await application.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
