const DOMPurify = require('dompurify');
const { createMarkdownRenderer } = require('./markdown');
const { DocumentSearch } = require('./search');
const { createVisualEditor } = require('./editor/editor');
const { createToolbar } = require('./editor/toolbar');

const $ = (selector) => document.querySelector(selector);
const content = $('#content');
const viewer = $('#viewer');
const toc = $('#toc');
const editorHost = $('#editor');
const editToolbar = $('#edit-toolbar');
const conflictBanner = $('#conflict-banner');
const searchPanel = $('#search-panel');
const searchInput = $('#search-input');
const searchCount = $('#search-count');
const shortcutsDialog = $('#shortcuts-dialog');
const renderMarkdown = createMarkdownRenderer(DOMPurify);
const documentSearch = new DocumentSearch(content);
const toolbar = createToolbar({
  root: editToolbar,
  linkDialog: $('#link-dialog'),
  imageDialog: $('#image-dialog'),
  chooseImage: () => window.mdview.chooseImage(),
  notify: (message, type) => showToast(message, type),
});

let currentDocument = null;
let currentTheme = readPreference('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
let zoom = Number(readPreference('zoom', '1'));
let sidebarVisible = readPreference('sidebar', 'true') === 'true';
let renderVersion = 0;
let dragDepth = 0;
let scrollTicking = false;
let tocHeadings = [];
// Edit mode state. `currentDocument.content` is always the last content known to be on disk.
let visualEditor = null;
let dirty = false;
let pendingDiskVersion = null;
let savedAt = null;
let saveInProgress = null;
let outlineTimer = null;
let lastModeToggle = 0;
let searchTimer = null;
const imageCache = new Map();

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(`mdview.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function savePreference(key, value) {
  try {
    localStorage.setItem(`mdview.${key}`, String(value));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('#toast-region').append(toast);
  setTimeout(() => toast.remove(), 4500);
}

function setTheme(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = currentTheme;
  savePreference('theme', currentTheme);
}

function setZoom(value) {
  zoom = Math.min(2, Math.max(0.5, Math.round(value * 10) / 10));
  window.mdview.setZoom(zoom);
  $('#zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  savePreference('zoom', zoom);
}

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  $('#sidebar').classList.toggle('collapsed', !sidebarVisible);
  $('#sidebar-button').classList.toggle('active', sidebarVisible);
  $('#sidebar-button').setAttribute('aria-pressed', String(sidebarVisible));
  savePreference('sidebar', sidebarVisible);
}

const isEditing = () => Boolean(visualEditor);

/** The element holding the document being shown: the rendered article or the editor surface. */
function documentRoot() {
  return visualEditor ? visualEditor.root : content;
}

function collectHeadings() {
  if (!visualEditor) return [...content.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
  return [...visualEditor.root.children].filter((child) => /^H[1-6]$/.test(child.tagName));
}

function buildToc() {
  toc.replaceChildren();
  tocHeadings = collectHeadings();
  $('#heading-count').textContent = String(tocHeadings.length);
  if (!tocHeadings.length) {
    const empty = document.createElement('div');
    empty.className = 'toc-empty';
    empty.textContent = 'Nessun titolo nel documento.';
    toc.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  tocHeadings.forEach((heading, index) => {
    const link = document.createElement('a');
    link.href = heading.id ? `#${heading.id}` : '#';
    link.dataset.index = String(index);
    link.dataset.level = heading.tagName.slice(1);
    link.textContent = heading.textContent.trim() || 'Sezione senza titolo';
    link.title = link.textContent;
    fragment.append(link);
  });
  toc.append(fragment);
  updateActiveHeading();
}

function updateActiveHeading() {
  if (!tocHeadings.length) return;
  const viewerTop = viewer.getBoundingClientRect().top;
  let active = 0;
  tocHeadings.forEach((heading, index) => {
    if (heading.getBoundingClientRect().top - viewerTop <= 90) active = index;
  });
  for (const link of toc.querySelectorAll('a')) {
    const selected = Number(link.dataset.index) === active;
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

function updateStats() {
  const text = documentRoot().textContent.trim();
  const words = text ? text.split(/\s+/u).length : 0;
  $('#word-count').textContent = `${words.toLocaleString('it-IT')} ${words === 1 ? 'parola' : 'parole'}`;
  $('#reading-time').textContent = `${Math.max(1, Math.ceil(words / 220))} min`;
}

/** The search of the document on screen: marks in the rendered article, decorations in the editor. */
function activeSearch() {
  return visualEditor ? visualEditor.search : documentSearch;
}

function updateSearchCount() {
  const search = activeSearch();
  const count = search.matches.length;
  const position = count ? search.current + 1 : 0;
  searchCount.textContent = count ? `${position} di ${count}` : '0 risultati';
}

function runSearch() {
  activeSearch().search(searchInput.value);
  updateSearchCount();
}

function stepSearch(direction) {
  const search = activeSearch();
  search.activate(search.current + direction);
  updateSearchCount();
}

function openSearch() {
  if (!currentDocument) return;
  searchPanel.hidden = false;
  $('#search-button').classList.add('active');
  searchInput.focus();
  searchInput.select();
}

function closeSearch(restoreFocus = true) {
  const returnFocus = !searchPanel.hidden && restoreFocus;
  clearTimeout(searchTimer);
  searchPanel.hidden = true;
  $('#search-button').classList.remove('active');
  searchInput.value = '';
  documentSearch.clear();
  if (visualEditor) {
    // Closing from the search panel leaves the active match selected, ready to be edited.
    if (returnFocus && !visualEditor.editor.view.hasFocus()) visualEditor.search.selectCurrent();
    visualEditor.search.clear();
  }
  updateSearchCount();
  if (!returnFocus) return;
  if (visualEditor) visualEditor.focus();
  else $('#search-button').focus();
}

/** Maps a document image reference to a URL the window is allowed to load. */
function resolveImage(source) {
  if (!source) return Promise.resolve('');
  if (!imageCache.has(source)) {
    imageCache.set(source, window.mdview.resolveResources([source]).then((resolved) => resolved[source] || source));
  }
  return imageCache.get(source);
}

async function resolveImages(root, isCurrent = () => true) {
  const images = [...root.querySelectorAll('img[src]')];
  const sources = [...new Set(images.map((image) => image.getAttribute('src')).filter(Boolean))];
  if (!sources.length) return;
  const resolved = await window.mdview.resolveResources(sources);
  if (!isCurrent()) return;
  for (const image of images) {
    const source = image.getAttribute('src');
    if (resolved[source]) image.src = resolved[source];
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
  }
}

function scrollRatio() {
  return viewer.scrollTop / Math.max(1, viewer.scrollHeight - viewer.clientHeight);
}

function restoreScroll(ratio) {
  requestAnimationFrame(() => {
    viewer.scrollTop = Math.round(ratio * Math.max(0, viewer.scrollHeight - viewer.clientHeight));
    updateScrollState();
  });
}

function updateDocumentChrome() {
  if (!currentDocument) return;
  document.title = `${dirty ? '● ' : ''}${currentDocument.name} — EDON MDView`;
  $('#document-name').textContent = currentDocument.name;
  $('#document-name').title = currentDocument.path;
  $('#dirty-indicator').hidden = !dirty;
  $('#status-path').textContent = currentDocument.path;
  $('#status-path').title = currentDocument.path;
  $('.live-status').classList.toggle('unsaved', dirty);
  let status = 'Aggiornamento automatico attivo';
  if (dirty) status = 'Modifiche non salvate';
  else if (isEditing() && savedAt) status = `Salvato alle ${savedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  else if (isEditing()) status = 'Modalità modifica';
  $('#status-text').textContent = status;
  $('#save-button').disabled = !dirty;
  $('#edit-button').disabled = false;
  $('#export-button').disabled = false;
  $('#print-button').disabled = false;
}

function applyDocument(documentData, preserveScroll = false) {
  const previousScroll = viewer.scrollTop;
  const ratio = scrollRatio();
  renderVersion += 1;
  const version = renderVersion;
  documentSearch.clear();
  closeSearch(false);
  if (!currentDocument || currentDocument.path !== documentData.path) imageCache.clear();
  currentDocument = documentData;
  content.classList.remove('welcome');
  content.innerHTML = renderMarkdown(documentData.content);
  updateDocumentChrome();
  buildToc();
  updateStats();
  updateSearchCount();
  resolveImages(content, () => version === renderVersion).catch((error) => showToast(error.message, 'warning'));
  requestAnimationFrame(() => {
    if (preserveScroll) {
      viewer.scrollTop = Math.min(previousScroll, Math.round(ratio * Math.max(0, viewer.scrollHeight - viewer.clientHeight)));
    } else {
      viewer.scrollTop = 0;
    }
    updateScrollState();
  });
}

function updateScrollState() {
  const maximum = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
  $('#scroll-progress').style.width = `${maximum ? (viewer.scrollTop / maximum) * 100 : 0}%`;
  updateActiveHeading();
}

// ------------------------------------------------------------------ edit mode

function setDirty(value) {
  if (value === dirty) return;
  dirty = value;
  window.mdview.setDirty(dirty);
  updateDocumentChrome();
}

function refreshDirty() {
  setDirty(Boolean(visualEditor) && visualEditor.getMarkdown() !== currentDocument.content);
}

function scheduleOutline() {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => {
    if (!visualEditor) return;
    buildToc();
    updateStats();
  }, 250);
}

function setConflict(documentData) {
  pendingDiskVersion = documentData;
  conflictBanner.hidden = !documentData;
}

function mountEditor() {
  visualEditor = createVisualEditor({
    host: editorHost,
    source: currentDocument.content,
    renderRaw: renderMarkdown,
    resolveImage,
    onChange: () => { refreshDirty(); scheduleOutline(); },
    // Typing with the search open changes the matches: the counter follows the editor.
    onStateChange: () => { toolbar.refresh(); if (!searchPanel.hidden) updateSearchCount(); },
  });
  toolbar.attach(visualEditor.editor);
  // The editor was rebuilt (file reloaded from disk) while searching: highlight the new document.
  if (!searchPanel.hidden) runSearch();
}

function unmountEditor() {
  clearTimeout(outlineTimer);
  toolbar.detach();
  if (visualEditor) visualEditor.destroy();
  visualEditor = null;
  editorHost.replaceChildren();
}

function setEditingChrome(editing) {
  $('#app').classList.toggle('editing', editing);
  content.hidden = editing;
  editorHost.hidden = !editing;
  editToolbar.hidden = !editing;
  $('#save-button').hidden = !editing;
  $('#edit-button').classList.toggle('active', editing);
  $('#edit-button').setAttribute('aria-pressed', String(editing));
}

function enterEditMode() {
  if (!currentDocument || isEditing()) return;
  const ratio = scrollRatio();
  closeSearch(false);
  savedAt = null;
  mountEditor();
  setEditingChrome(true);
  refreshDirty();
  updateDocumentChrome();
  buildToc();
  updateStats();
  restoreScroll(ratio);
  visualEditor.focus();
}

/** Leaves edit mode. Unsaved changes are saved or discarded only after an explicit choice. */
async function exitEditMode() {
  if (!isEditing()) return true;
  if (dirty) {
    const choice = await window.mdview.confirmUnsaved();
    if (choice === 'cancel' || !isEditing()) return false;
    if (choice === 'save' && !(await saveDocument())) return false;
  }
  const ratio = scrollRatio();
  const latest = pendingDiskVersion || currentDocument;
  unmountEditor();
  setConflict(null);
  setEditingChrome(false);
  setDirty(false);
  savedAt = null;
  applyDocument(latest, true);
  restoreScroll(ratio);
  return true;
}

function toggleEditMode() {
  // The same shortcut can arrive from the page and from the application menu.
  const now = performance.now();
  if (now - lastModeToggle < 300) return;
  lastModeToggle = now;
  if (isEditing()) exitEditMode().catch((error) => showToast(error.message, 'error'));
  else enterEditMode();
}

function reloadEditor(documentData) {
  const ratio = scrollRatio();
  currentDocument = documentData;
  unmountEditor();
  mountEditor();
  setConflict(null);
  refreshDirty();
  updateDocumentChrome();
  buildToc();
  updateStats();
  restoreScroll(ratio);
}

function markSaved(markdown, result) {
  if (currentDocument.path !== result.path) imageCache.clear();
  currentDocument = { ...currentDocument, path: result.path, name: result.name, content: markdown };
  savedAt = new Date();
  setConflict(null);
  if (isEditing()) refreshDirty();
  updateDocumentChrome();
}

async function performSave(saveAs) {
  if (!currentDocument) return false;
  if (!saveAs) {
    if (!isEditing()) return false;
    if (pendingDiskVersion) {
      showToast('Il file è cambiato su disco: scegli prima se ricaricarlo o mantenere le tue modifiche.', 'warning');
      $('#conflict-keep').focus();
      return false;
    }
    if (!dirty) return true;
  }
  const markdown = isEditing() ? visualEditor.getMarkdown() : currentDocument.content;
  const result = saveAs ? await window.mdview.saveDocumentAs(markdown) : await window.mdview.saveDocument(markdown);
  if (result.status === 'saved') {
    markSaved(markdown, result);
    showToast(saveAs ? `Documento salvato: ${result.path}` : 'Documento salvato');
    return true;
  }
  if (result.status === 'conflict') {
    showToast('Il file è cambiato su disco mentre lo modificavi: nulla è stato sovrascritto.', 'warning');
  } else if (result.status === 'error') {
    showToast(`Salvataggio non riuscito: ${result.message}`, 'error');
  }
  return false;
}

/** Saves run one at a time: a second request waits for the first and reports its own result. */
function queueSave(saveAs) {
  const run = () => performSave(saveAs).catch((error) => {
    showToast(`Salvataggio non riuscito: ${error.message}`, 'error');
    return false;
  });
  saveInProgress = saveInProgress ? saveInProgress.then(run) : run();
  const queued = saveInProgress;
  queued.finally(() => { if (saveInProgress === queued) saveInProgress = null; });
  return queued;
}

const saveDocument = () => queueSave(false);
const saveDocumentAs = () => queueSave(true);

function handleDiskChange(documentData) {
  if (!isEditing()) {
    applyDocument(documentData, true);
    showToast('Documento aggiornato');
    return;
  }
  if (documentData.content === currentDocument.content) {
    setConflict(null);
    return;
  }
  if (documentData.content === visualEditor.getMarkdown()) {
    currentDocument = documentData;
    setConflict(null);
    refreshDirty();
    return;
  }
  if (!dirty) {
    reloadEditor(documentData);
    showToast('Documento aggiornato');
    return;
  }
  setConflict(documentData);
}

function handleDocumentLoaded(documentData) {
  // The main process has already asked about unsaved changes before opening another document.
  if (isEditing()) {
    unmountEditor();
    setEditingChrome(false);
  }
  setConflict(null);
  savedAt = null;
  dirty = false;
  window.mdview.setDirty(false);
  applyDocument(documentData);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function collectedStyles() {
  const styles = [];
  for (const sheet of document.styleSheets) {
    try {
      styles.push(...[...sheet.cssRules].map((rule) => rule.cssText));
    } catch {
      // Same-origin application styles are normally always readable.
    }
  }
  return styles.join('\n');
}

async function exportDocument() {
  if (!currentDocument) return;
  $('#export-button').disabled = true;
  try {
    let clone;
    if (isEditing()) {
      // Export what is on screen, rendered exactly as reading mode would show it.
      clone = document.createElement('article');
      clone.innerHTML = renderMarkdown(visualEditor.getMarkdown());
      await resolveImages(clone);
    } else {
      clone = content.cloneNode(true);
    }
    for (const mark of clone.querySelectorAll('mark.search-highlight')) mark.replaceWith(document.createTextNode(mark.textContent));
    const localImages = [...clone.querySelectorAll('img[src^="mdview:"]')];
    const sources = [...new Set(localImages.map((image) => image.getAttribute('src')))];
    const embedded = await window.mdview.embedImages(sources);
    for (const image of localImages) {
      const source = image.getAttribute('src');
      if (embedded[source]) image.setAttribute('src', embedded[source]);
      image.removeAttribute('loading');
    }
    clone.removeAttribute('class');
    clone.removeAttribute('hidden');
    clone.classList.add('markdown-body');
    const title = escapeHtml(currentDocument.name.replace(/\.[^.]+$/, ''));
    const html = `<!doctype html>
<html lang="it" data-theme="${currentTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="EDON MDView 1.0.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:;">
<title>${title}</title>
<style>${collectedStyles()}</style>
</head>
<body style="overflow:auto;height:auto;background:var(--bg)">
${clone.outerHTML}
</body>
</html>`;
    const savedPath = await window.mdview.exportDocument(html);
    if (savedPath) showToast(`HTML esportato: ${savedPath}`);
  } catch (error) {
    showToast(`Esportazione non riuscita: ${error.message}`, 'error');
  } finally {
    $('#export-button').disabled = false;
  }
}

$('#open-button').addEventListener('click', () => window.mdview.chooseDocument().catch(() => {}));
$('#welcome-open').addEventListener('click', () => window.mdview.chooseDocument().catch(() => {}));
$('#sidebar-button').addEventListener('click', toggleSidebar);
$('#theme-button').addEventListener('click', () => setTheme(currentTheme === 'dark' ? 'light' : 'dark'));
$('#search-button').addEventListener('click', () => searchPanel.hidden ? openSearch() : closeSearch());
$('#search-close').addEventListener('click', () => closeSearch());
$('#search-next').addEventListener('click', () => stepSearch(1));
$('#search-previous').addEventListener('click', () => stepSearch(-1));
$('#export-button').addEventListener('click', exportDocument);
$('#print-button').addEventListener('click', () => window.mdview.printDocument());
$('#edit-button').addEventListener('click', toggleEditMode);
$('#save-button').addEventListener('click', saveDocument);
$('#save-as-button').addEventListener('click', saveDocumentAs);
$('#conflict-reload').addEventListener('click', () => { if (pendingDiskVersion) reloadEditor(pendingDiskVersion); });
$('#conflict-keep').addEventListener('click', () => {
  if (!pendingDiskVersion) return;
  // The disk version becomes the baseline: the next save knowingly replaces it.
  currentDocument = pendingDiskVersion;
  setConflict(null);
  refreshDirty();
  updateDocumentChrome();
  visualEditor.focus();
});
$('#shortcuts-button').addEventListener('click', () => shortcutsDialog.showModal());
$('#shortcuts-close').addEventListener('click', () => shortcutsDialog.close());
shortcutsDialog.addEventListener('click', (event) => {
  if (event.target === shortcutsDialog) shortcutsDialog.close();
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 120);
});
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    stepSearch(event.shiftKey ? -1 : 1);
  }
});

toc.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-index]');
  if (!link) return;
  event.preventDefault();
  const heading = tocHeadings[Number(link.dataset.index)];
  if (!heading || !heading.isConnected) return;
  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (heading.id) history.replaceState(null, '', `#${encodeURIComponent(heading.id)}`);
});

content.addEventListener('click', async (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (href.startsWith('#')) {
    event.preventDefault();
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (/^(https?|mailto):/i.test(href)) {
    event.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  } else if (!/^[a-z][a-z\d+.-]*:/i.test(href)) {
    event.preventDefault();
    try {
      await window.mdview.openRelative(href);
    } catch {
      showToast('Il collegamento locale non è un documento Markdown consentito.', 'warning');
    }
  } else {
    event.preventDefault();
  }
});

// Links inside the editor (including protected HTML blocks) are content to edit, never navigation.
editorHost.addEventListener('click', (event) => {
  if (event.target.closest('a[href]')) event.preventDefault();
});

viewer.addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    updateScrollState();
    scrollTicking = false;
  });
});

// Only files open a document: text dragged inside the editor is handled by the editor itself.
const isFileDrag = (event) => Boolean(event.dataTransfer) && [...event.dataTransfer.types].includes('Files');

window.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  $('#drag-overlay').hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drag-overlay').hidden = true;
});
window.addEventListener('drop', async (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $('#drag-overlay').hidden = true;
  const file = event.dataTransfer.files[0];
  if (!file) return;
  try {
    const filePath = window.mdview.pathForFile(file);
    if (!filePath) throw new Error('Percorso del file non disponibile.');
    await window.mdview.openDocument(filePath);
  } catch (error) {
    showToast(error.message, 'error');
  }
});

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && !event.altKey && ['-', '+', '=', '0', 'Subtract', 'Add', 'Numpad0'].includes(event.key)) {
    event.preventDefault();
    if (event.key === '-' || event.key === 'Subtract') setZoom(zoom - 0.1);
    else if (event.key === '+' || event.key === '=' || event.key === 'Add') setZoom(zoom + 0.1);
    else setZoom(1);
  }
  if (event.ctrlKey && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      if (event.shiftKey) saveDocumentAs();
      else saveDocument();
    } else if (key === 'e' && !event.shiftKey) {
      event.preventDefault();
      toggleEditMode();
    } else if (key === 'k' && !event.shiftKey && isEditing()) {
      event.preventDefault();
      toolbar.openLink();
    }
  }
  // With a dialog open Esc closes the dialog only: the search stays as it is.
  if (event.key === 'Escape' && !searchPanel.hidden && !document.querySelector('dialog[open]')) closeSearch();
  if (event.key === 'F3' && !searchPanel.hidden) {
    event.preventDefault();
    stepSearch(event.shiftKey ? -1 : 1);
  }
});

window.mdview.onDocumentLoaded(handleDocumentLoaded);
window.mdview.onDocumentChanged(handleDiskChange);
window.mdview.onNotification(({ type, message }) => showToast(message, type));
window.mdview.onSearchOpen(openSearch);
window.mdview.onToggleSidebar(toggleSidebar);
window.mdview.onToggleTheme(() => setTheme(currentTheme === 'dark' ? 'light' : 'dark'));
window.mdview.onZoom((delta) => setZoom(delta === 0 ? 1 : zoom + delta));
window.mdview.onExportRequest(exportDocument);
window.mdview.onPrintRequest(() => window.mdview.printDocument());
window.mdview.onShortcuts(() => shortcutsDialog.showModal());
window.mdview.onEditToggle(toggleEditMode);
window.mdview.onEditCommand((command) => { if (isEditing()) toolbar.run(command); });
window.mdview.onSaveAsRequest(saveDocumentAs);
window.mdview.onSaveRequest(async (request) => {
  const saved = await saveDocument();
  // A request with an id comes from a «Salva» answer in the main process, which waits for the outcome.
  if (request && request.id != null) window.mdview.reportSaveResult(request.id, saved || !dirty);
});

setTheme(currentTheme);
setZoom(Number.isFinite(zoom) ? zoom : 1);
if (!sidebarVisible) {
  sidebarVisible = true;
  toggleSidebar();
}
