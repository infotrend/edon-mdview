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
  application = await electron.launch({
    executablePath,
    args: [documentPath],
    cwd: temp,
    timeout: 60000,
  });
  const page = await application.firstWindow({ timeout: 45000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('#content h1').first()).toHaveText('Guida Markdown', { timeout: 30000 });
  await expect(page.locator('#toc a')).toHaveCount(4);
  await expect.poll(() => page.locator('#content img[alt="Logo locale"]').evaluate((image) => image.naturalWidth)).toBe(240);
  await page.locator('#content a[href="secondo.md"]').click();
  await expect(page.locator('#content h1')).toHaveText('Secondo documento');
  assert.deepEqual(errors, []);
  console.log(`Pacchetto verificato: ${executablePath}`);
  console.log('OK avvio, rendering, protocollo immagini e navigazione nell’eseguibile pacchettizzato');
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
