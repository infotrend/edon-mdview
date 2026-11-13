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
  contentHash,
  ensureMarkdownExtension,
  toDocumentReference,
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
// Editing state. The renderer reports unsaved changes; `diskHash` identifies the file content the
// renderer is working from, so the app's own writes and no-op file events never trigger a reload.
let documentDirty = false;
let documentBom = false;
let diskHash = null;
let saving = false;
let closeConfirmed = false;
let unsavedPrompt = null;
let saveRequestId = 0;
const pendingSaveRequests = new Map();
const recentFilePath = () => path.join(app.getPath('userData'), 'recent-files.json');

// Automated tests run with their own profile: the single-instance lock and the recent files then
// belong to the test run, which can never hand its documents to a copy the user already has open.
if (process.env.EDON_MDVIEW_USER_DATA) app.setPath('userData', path.resolve(process.env.EDON_MDVIEW_USER_DATA));

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
    bom: content.startsWith('\uFEFF'),
  };
}

function sendDocumentChanged(document) {
  diskHash = contentHash(document.content);
  documentBom = document.bom;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('document:changed', document);
}

function askUnsavedChanges() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve('discard');
  if (!unsavedPrompt) {
    const name = currentDocument ? path.basename(currentDocument) : 'documento';
    unsavedPrompt = dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Modifiche non salvate',
      message: `Vuoi salvare le modifiche a \u00AB${name}\u00BB?`,
      detail: 'Se non le salvi, le modifiche andranno perse.',
      buttons: ['Salva', 'Non salvare', 'Annulla'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }).then(({ response }) => ['save', 'discard', 'cancel'][response] || 'cancel')
      .finally(() => { unsavedPrompt = null; });
  }
  return unsavedPrompt;
}

function requestRendererSave() {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) { resolve(false); return; }
    saveRequestId += 1;
    const id = saveRequestId;
    const timer = setTimeout(() => { pendingSaveRequests.delete(id); resolve(false); }, 120000);
    pendingSaveRequests.set(id, (saved) => { clearTimeout(timer); pendingSaveRequests.delete(id); resolve(saved); });
    mainWindow.webContents.send('document:save-request', { id });
  });
}

/** Resolves to true when it is safe to drop the current editor state (saved, discarded or nothing to lose). */
async function confirmUnsavedChanges() {
  if (!documentDirty || !mainWindow || mainWindow.isDestroyed()) return true;
  const choice = await askUnsavedChanges();
  if (choice === 'cancel') return false;
  if (choice === 'save') return requestRendererSave();
  return true;
}

function validateContent(content) {
  if (typeof content !== 'string' || content.includes('\0')) throw new Error('Contenuto del documento non valido.');
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_SIZE) throw new Error('Il documento supera il limite di 25 MB.');
}

async function writeDocument(filePath, content) {
  saving = true;
  try {
    await fsp.writeFile(filePath, `${documentBom ? '\uFEFF' : ''}${content}`, 'utf8');
    diskHash = contentHash(content);
    documentDirty = false;
  } finally {
    saving = false;
  }
}

/** Writes the editor content to the open document only: the renderer never supplies a path. */
async function saveDocument(content) {
  try {
    if (!currentDocument) throw new Error('Nessun documento aperto.');
    validateContent(content);
    const target = currentDocument;
    let onDisk = null;
    try {
      onDisk = await readDocument(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (onDisk && contentHash(onDisk.content) !== diskHash) {
      sendDocumentChanged(onDisk);
      return { status: 'conflict' };
    }
    await writeDocument(target, content);
    return { status: 'saved', path: target, name: path.basename(target) };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function saveDocumentAs(content) {
  try {
    if (!currentDocument || !mainWindow) throw new Error('Nessun documento aperto.');
    validateContent(content);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva con nome',
      defaultPath: currentDocument,
      filters: [
        { name: 'Documenti Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: 'File di testo', extensions: ['txt'] },
      ],
    });
    if (result.canceled || !result.filePath) return { status: 'canceled' };
    const chosen = path.resolve(result.filePath);
    const target = ensureMarkdownExtension(chosen);
    // The system dialog only confirmed overwriting the name the user typed.
    if (target !== chosen && fs.existsSync(target)) throw new Error(`Esiste gi\u00E0 un file \u00AB${path.basename(target)}\u00BB: scegli un altro nome.`);
    const previous = currentDocument;
    stopWatching();
    try {
      await writeDocument(target, content);
    } catch (error) {
      watchDocument(previous);
      throw error;
    }
    currentDocument = target;
    watchDocument(target);
    rememberDocument(target);
    return { status: 'saved', path: target, name: path.basename(target) };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function chooseImage() {
  if (!currentDocument || !mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Scegli un\'immagine',
    defaultPath: path.dirname(currentDocument),
    properties: ['openFile'],
    filters: [{ name: 'Immagini', extensions: [...IMAGE_TYPES.keys()].map((extension) => extension.slice(1)) }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const reference = toDocumentReference(currentDocument, result.filePaths[0]);
  if (!reference || !IMAGE_TYPES.has(path.extname(result.filePaths[0]).toLowerCase())) {
    return { error: 'L\'immagine deve trovarsi nella cartella del documento o in una sua sottocartella.' };
  }
  return { reference, name: path.basename(result.filePaths[0]) };
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
      const check = async () => {
        if (!currentDocument || currentDocument !== filePath) return;
        // Never read a file the app is still writing: wait for the save to finish.
        if (saving) { reloadTimer = setTimeout(check, 120); return; }
        try {
          const document = await readDocument(filePath);
          if (saving) { reloadTimer = setTimeout(check, 120); return; }
          if (currentDocument !== filePath || contentHash(document.content) === diskHash) return;
          sendDocumentChanged(document);
        } catch (error) {
          if (currentDocument === filePath) notify('warning', `Ricaricamento non riuscito: ${error.message}`);
        }
      };
      reloadTimer = setTimeout(check, 180);
    });
    watcher.on('error', () => notify('warning', 'Aggiornamento automatico non disponibile per questo file.'));
  } catch {
    notify('warning', 'Aggiornamento automatico non disponibile per questo file.');
  }
}

async function loadDocument(filePath) {
  try {
    if (!(await confirmUnsavedChanges())) return null;
    const document = await readDocument(filePath);
    currentDocument = document.path;
    documentDirty = false;
    documentBom = document.bom;
    diskHash = contentHash(document.content);
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
    sendDocumentChanged(await readDocument(currentDocument));
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
        { label: 'Salva', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('document:save-request', { id: null }) },
        { label: 'Salva con nome…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('document:save-as-request') },
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
        { label: 'Modifica documento', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('edit:toggle') },
        { type: 'separator' },
        // The editor keeps its own history: the shortcuts are shown here but handled by the page.
        { label: 'Annulla', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => mainWindow?.webContents.send('edit:command', 'undo') },
        { label: 'Ripeti', accelerator: 'CmdOrCtrl+Y', registerAccelerator: false, click: () => mainWindow?.webContents.send('edit:command', 'redo') },
        { type: 'separator' },
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
        { label: 'Informazioni su EDON MDView', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'EDON MDView', message: `EDON MDView ${app.getVersion()}`, detail: 'Sviluppato da INFOTREND SRL\nLicenza FSL-1.1-MIT\n\nVisualizzatore ed editor Markdown per Windows\nRendering locale, sicuro e senza tracciamento.' }) },
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
  mainWindow.on('close', (event) => {
    if (!documentDirty || closeConfirmed) return;
    event.preventDefault();
    confirmUnsavedChanges().then((proceed) => {
      if (!proceed || !mainWindow || mainWindow.isDestroyed()) return;
      closeConfirmed = true;
      mainWindow.close();
    });
  });
  mainWindow.on('closed', () => {
    stopWatching();
    for (const resolve of [...pendingSaveRequests.values()]) resolve(false);
    mainWindow = null;
    windowReady = false;
    currentDocument = null;
    documentDirty = false;
    closeConfirmed = false;
    diskHash = null;
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
    ipcMain.handle('document:save', (event, content) => saveDocument(content));
    ipcMain.handle('document:save-as', (event, content) => saveDocumentAs(content));
    ipcMain.handle('document:confirm-unsaved', () => askUnsavedChanges());
    ipcMain.handle('document:choose-image', chooseImage);
    ipcMain.on('document:dirty', (event, dirty) => { documentDirty = Boolean(dirty) && Boolean(currentDocument); });
    ipcMain.on('document:save-result', (event, result) => {
      const resolve = result && pendingSaveRequests.get(result.id);
      if (resolve) resolve(Boolean(result.saved));
    });
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
