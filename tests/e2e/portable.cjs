const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const executablePath = path.resolve(process.argv[2] || 'release/EDON-MDView-Portable-1.0.0-x64.exe');
const root = path.resolve(__dirname, '..', '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdview-portable-test-'));
const documentPath = path.join(temp, 'documento.md');
fs.cpSync(path.join(root, 'tests', 'fixtures'), temp, { recursive: true });

let launcher;
let browser;
let launcherExited = false;

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForDebugger(port) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return;
    } catch {
      // The portable launcher needs a few seconds to extract and start Electron.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Il debug remoto della versione portabile non è diventato disponibile.');
}

async function run() {
  const port = await availablePort();
  launcher = spawn(executablePath, [documentPath, `--remote-debugging-port=${port}`], {
    cwd: temp,
    stdio: 'ignore',
  });
  launcher.once('exit', () => { launcherExited = true; });
  await waitForDebugger(port);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => candidate.url().includes('index.html')) || context.pages()[0];
  assert.ok(page, 'Finestra della versione portabile non trovata');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await expect(page.locator('#content h1').first()).toHaveText('Guida Markdown', { timeout: 30000 });
  await expect(page.locator('#toc a')).toHaveCount(4);
  await expect.poll(() => page.locator('#content img[alt="Logo locale"]').evaluate((image) => image.naturalWidth)).toBe(240);
  await page.locator('#content a[href="secondo.md"]').click();
  await expect(page.locator('#content h1')).toHaveText('Secondo documento');
  assert.deepEqual(errors, []);
  console.log(`Pacchetto portabile verificato: ${executablePath}`);
  console.log('OK estrazione, avvio, rendering, immagini e navigazione della versione portabile');

  const session = await context.newCDPSession(page);
  await session.send('Page.close');
  await Promise.race([once(launcher, 'exit'), new Promise((resolve) => setTimeout(resolve, 10000))]);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (launcher && !launcherExited) spawnSync('taskkill', ['/pid', String(launcher.pid), '/t', '/f'], { stdio: 'ignore' });
    fs.rmSync(temp, { recursive: true, force: true });
  });
