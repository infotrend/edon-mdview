const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const { pathToFileURL } = require('node:url');
const {
  isMarkdownPath,
  resolveLocalPath,
  resolveLinkedDocument,
  toResourceUrl,
} = require('./main-utils');

const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'], ['.ico', 'image/x-icon'], ['.avif', 'image/avif'],
]);

let mainWindow = null;
let currentDocument = null;
let pendingDocument = findDocumentArgument(process.argv);
let watcher = null;
let reloadTimer = null;
let windowReady = false;
let recentFiles = [];
const recentFilePath = () => path.join(app.getPath('userData'), 'recent-files.json');

protocol.registerSchemesAsPrivileged([
  { scheme: 'mdview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function findDocumentArgument(argv) {
  const candidate = argv.slice(1).find((argument) => !argument.startsWith('-') && isMarkdownPath(argument));
  return candidate ? path.resolve(candidate) : null;
}

function loadRecentFiles() {
  try {
    const saved = JSON.parse(fs.readFileSync(recentFilePath(), 'utf8'));
    recentFiles = Array.isArray(saved) ? saved.filter((file) => typeof file === 'string').slice(0, 8) : [];
  } catch {
    recentFiles = [];
  }
}

function saveRecentFiles() {
  try {
    fs.mkdirSync(path.dirname(recentFilePath()), { recursive: true });
    fs.writeFileSync(recentFilePath(), JSON.stringify(recentFiles), 'utf8');
  } catch {
    // A blocked preference file must not prevent documents from opening.
  }
}

function rememberDocument(filePath) {
  recentFiles = [filePath, ...recentFiles.filter((file) => file.toLowerCase() !== filePath.toLowerCase())].slice(0, 8);
  saveRecentFiles();
  rebuildMenu();
}

function notify(type, message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:notification', { type, message });
}

async function readDocument(filePath) {
  const resolved = path.resolve(filePath);
  if (!isMarkdownPath(resolved)) throw new Error('Il file selezionato non è un documento Markdown.');
  const stat = await fsp.stat(resolved);
  if (!stat.isFile()) throw new Error('Il percorso selezionato non è un file.');
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error('Il documento supera il limite di 25 MB.');
  const content = await fsp.readFile(resolved, 'utf8');
  if (content.includes('\0')) throw new Error('Il file non sembra essere un documento di testo.');
  return {
    path: resolved,
    name: path.basename(resolved),
    content: content.replace(/^\uFEFF/, ''),
    modified: stat.mtimeMs,
  };
}

function stopWatching() {
  if (watcher) watcher.close();
  watcher = null;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = null;
}

function watchDocument(filePath) {
  stopWatching();
  try {
    watcher = fs.watch(path.dirname(filePath), (eventType, filename) => {
      if (!currentDocument || (filename && filename.toString().toLowerCase() !== path.basename(filePath).toLowerCase())) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        if (!currentDocument || currentDocument !== filePath) return;
        try {
          const document = await readDocument(filePath);
          if (currentDocument === filePath && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('document:changed', document);
          }
        } catch (error) {
          if (currentDocument === filePath) notify('warning', `Ricaricamento non riuscito: ${error.message}`);
        }
      }, 180);
    });
    watcher.on('error', () => notify('warning', 'Aggiornamento automatico non disponibile per questo file.'));
  } catch {
    notify('warning', 'Aggiornamento automatico non disponibile per questo file.');
  }
}

async function loadDocument(filePath) {
  try {
    const document = await readDocument(filePath);
    currentDocument = document.path;
    watchDocument(document.path);
    rememberDocument(document.path);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`${document.name} — EDON MDView`);
      mainWindow.webContents.send('document:loaded', document);
      mainWindow.show();
      mainWindow.focus();
    }
    return document;
  } catch (error) {
    notify('error', error.message);
    throw error;
  }
}

async function chooseAndOpen() {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Apri documento Markdown',
    properties: ['openFile'],
    filters: [
      { name: 'Documenti Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
      { name: 'Tutti i file', extensions: ['*'] },
    ],
  });
  if (!result.canceled && result.filePaths[0]) await loadDocument(result.filePaths[0]);
}

async function reloadDocument() {
  if (!currentDocument) return;
  try {
    const document = await readDocument(currentDocument);
    mainWindow?.webContents.send('document:changed', document);
  } catch (error) {
    notify('error', error.message);
  }
}

function rebuildMenu() {
  const recentMenu = recentFiles.length
    ? recentFiles.map((file) => ({ label: path.basename(file), toolTip: file, click: () => loadDocument(file).catch(() => {}) }))
    : [{ label: 'Nessun file recente', enabled: false }];

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Apri…', accelerator: 'CmdOrCtrl+O', click: chooseAndOpen },
        { label: 'Apri recente', submenu: [...recentMenu, { type: 'separator' }, { label: 'Svuota elenco', enabled: recentFiles.length > 0, click: () => { recentFiles = []; saveRecentFiles(); rebuildMenu(); } }] },
        { type: 'separator' },
        { label: 'Ricarica', accelerator: 'F5', click: reloadDocument },
        { type: 'separator' },
        { label: 'Esporta HTML…', accelerator: 'CmdOrCtrl+Shift+E', click: () => mainWindow?.webContents.send('document:export-request') },
        { label: 'Stampa…', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.send('document:print-request') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close', label: 'Chiudi finestra' } : { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'copy', label: 'Copia' },
        { role: 'cut', label: 'Taglia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' },
        { type: 'separator' },
        { label: 'Cerca nel documento', accelerator: 'CmdOrCtrl+F', click: () => mainWindow?.webContents.send('search:open') },
      ],
    },
    {
      label: 'Visualizza',
      submenu: [
        { label: 'Mostra/nascondi indice', accelerator: 'CmdOrCtrl+\\', click: () => mainWindow?.webContents.send('view:toggle-sidebar') },
        { label: 'Cambia tema', accelerator: 'CmdOrCtrl+Shift+T', click: () => mainWindow?.webContents.send('view:toggle-theme') },
        { type: 'separator' },
        { label: 'Aumenta zoom', accelerator: 'CmdOrCtrl+Plus', click: () => mainWindow?.webContents.send('view:zoom', 0.1) },
        { label: 'Riduci zoom', accelerator: 'CmdOrCtrl+-', click: () => mainWindow?.webContents.send('view:zoom', -0.1) },
        { label: 'Zoom predefinito', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.send('view:zoom', 0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
      ],
    },
    {
      label: 'Aiuto',
      submenu: [
        { label: 'Scorciatoie da tastiera', click: () => mainWindow?.webContents.send('help:shortcuts') },
        { label: 'Informazioni su EDON MDView', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'EDON MDView', message: 'EDON MDView 1.0.0', detail: 'Sviluppato da INFOTREND SRL\nLicenza FSL-1.1-MIT\n\nVisualizzatore Markdown per Windows\nRendering locale, sicuro e senza tracciamento.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#101214',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    title: 'EDON MDView',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.once('did-finish-load', async () => {
    windowReady = true;
    if (pendingDocument) {
      const file = pendingDocument;
      pendingDocument = null;
      await loadDocument(file).catch(() => {});
    }
  });
  mainWindow.on('closed', () => {
    stopWatching();
    mainWindow = null;
    windowReady = false;
    currentDocument = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const file = findDocumentArgument(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (file && windowReady) loadDocument(file).catch(() => {});
    } else if (file) {
      pendingDocument = file;
    }
  });

  app.whenReady().then(() => {
    loadRecentFiles();
    rebuildMenu();

    protocol.handle('mdview', async (request) => {
      try {
        if (!currentDocument) return new Response('Nessun documento aperto', { status: 403 });
        const resourcePath = resolveLocalPath(currentDocument, request.url);
        if (!resourcePath || !IMAGE_TYPES.has(path.extname(resourcePath).toLowerCase())) {
          return new Response('Risorsa non consentita', { status: 403 });
        }
        const [rootReal, resourceReal] = await Promise.all([
          fsp.realpath(path.dirname(currentDocument)),
          fsp.realpath(resourcePath),
        ]);
        const { isPathInside } = require('./main-utils');
        if (!isPathInside(rootReal, resourceReal)) return new Response('Risorsa esterna non consentita', { status: 403 });
        return net.fetch(pathToFileURL(resourceReal).toString());
      } catch {
        return new Response('Risorsa non trovata', { status: 404 });
      }
    });

    ipcMain.handle('document:choose', chooseAndOpen);
    ipcMain.handle('document:open-path', (event, filePath) => loadDocument(filePath));
    ipcMain.handle('document:open-relative', (event, reference) => {
      const filePath = resolveLinkedDocument(currentDocument, reference);
      if (!filePath) throw new Error('Il collegamento non punta a un documento Markdown locale consentito.');
      return loadDocument(filePath);
    });
    ipcMain.handle('document:reload', reloadDocument);
    ipcMain.handle('document:print', () => {
      if (!mainWindow || !currentDocument) return;
      mainWindow.webContents.print({ printBackground: true }, (success, reason) => {
        if (!success && reason !== 'cancelled') notify('error', `Stampa non riuscita: ${reason}`);
      });
    });
    ipcMain.handle('document:resolve-resources', (event, sources) => {
      if (!Array.isArray(sources)) return {};
      return Object.fromEntries(sources.slice(0, 500).map((source) => {
        const resolved = typeof source === 'string' ? resolveLocalPath(currentDocument, source) : null;
        return [source, resolved && IMAGE_TYPES.has(path.extname(resolved).toLowerCase()) ? toResourceUrl(resolved) : source];
      }));
    });
    ipcMain.handle('document:embed-images', async (event, sources) => {
      const embedded = {};
      if (!Array.isArray(sources)) return embedded;
      for (const source of sources.slice(0, 200)) {
        try {
          const filePath = resolveLocalPath(currentDocument, source);
          const mime = filePath && IMAGE_TYPES.get(path.extname(filePath).toLowerCase());
          if (!filePath || !mime) continue;
          const [rootReal, resourceReal, stat] = await Promise.all([
            fsp.realpath(path.dirname(currentDocument)),
            fsp.realpath(filePath),
            fsp.stat(filePath),
          ]);
          const { isPathInside } = require('./main-utils');
          if (!isPathInside(rootReal, resourceReal) || !stat.isFile() || stat.size > MAX_IMAGE_SIZE) continue;
          const data = await fsp.readFile(resourceReal);
          embedded[source] = `data:${mime};base64,${data.toString('base64')}`;
        } catch {
          // Missing images retain their original source and alt text in the export.
        }
      }
      return embedded;
    });
    ipcMain.handle('document:export', async (event, html) => {
      if (!currentDocument || typeof html !== 'string') return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Esporta documento HTML',
        defaultPath: path.join(path.dirname(currentDocument), `${path.basename(currentDocument, path.extname(currentDocument))}.html`),
        filters: [{ name: 'Documento HTML', extensions: ['html'] }],
      });
      if (result.canceled || !result.filePath) return null;
      await fsp.writeFile(result.filePath, html, 'utf8');
      return result.filePath;
    });

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
