const DOMPurify = require('dompurify');
const { createMarkdownRenderer } = require('./markdown');
const { DocumentSearch } = require('./search');

const $ = (selector) => document.querySelector(selector);
const content = $('#content');
const viewer = $('#viewer');
const toc = $('#toc');
const searchPanel = $('#search-panel');
const searchInput = $('#search-input');
const searchCount = $('#search-count');
const shortcutsDialog = $('#shortcuts-dialog');
const renderMarkdown = createMarkdownRenderer(DOMPurify);
const documentSearch = new DocumentSearch(content);

let currentDocument = null;
let currentTheme = readPreference('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
let zoom = Number(readPreference('zoom', '1'));
let sidebarVisible = readPreference('sidebar', 'true') === 'true';
let renderVersion = 0;
let dragDepth = 0;
let scrollTicking = false;

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

function buildToc() {
  toc.replaceChildren();
  const headings = [...content.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
  $('#heading-count').textContent = String(headings.length);
  if (!headings.length) {
    const empty = document.createElement('div');
    empty.className = 'toc-empty';
    empty.textContent = 'Nessun titolo nel documento.';
    toc.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const heading of headings) {
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.dataset.target = heading.id;
    link.dataset.level = heading.tagName.slice(1);
    link.textContent = heading.textContent.trim() || 'Sezione senza titolo';
    link.title = link.textContent;
    fragment.append(link);
  }
  toc.append(fragment);
  updateActiveHeading();
}

function updateActiveHeading() {
  const headings = [...content.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
  if (!headings.length) return;
  const viewerTop = viewer.getBoundingClientRect().top;
  let active = headings[0];
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top - viewerTop <= 90) active = heading;
    else break;
  }
  for (const link of toc.querySelectorAll('a')) {
    const selected = link.dataset.target === active.id;
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

function updateStats() {
  const text = content.textContent.trim();
  const words = text ? text.split(/\s+/u).length : 0;
  $('#word-count').textContent = `${words.toLocaleString('it-IT')} ${words === 1 ? 'parola' : 'parole'}`;
  $('#reading-time').textContent = `${Math.max(1, Math.ceil(words / 220))} min`;
}

function updateSearchCount() {
  const count = documentSearch.matches.length;
  const position = count ? documentSearch.current + 1 : 0;
  searchCount.textContent = count ? `${position} di ${count}` : '0 risultati';
}

function openSearch() {
  if (!currentDocument) return;
  searchPanel.hidden = false;
  $('#search-button').classList.add('active');
  searchInput.focus();
  searchInput.select();
}

function closeSearch() {
  searchPanel.hidden = true;
  $('#search-button').classList.remove('active');
  searchInput.value = '';
  documentSearch.clear();
  updateSearchCount();
  $('#search-button').focus();
}

async function resolveImages(version) {
  const images = [...content.querySelectorAll('img[src]')];
  const sources = [...new Set(images.map((image) => image.getAttribute('src')).filter(Boolean))];
  if (!sources.length) return;
  const resolved = await window.mdview.resolveResources(sources);
  if (version !== renderVersion) return;
  for (const image of images) {
    const source = image.getAttribute('src');
    if (resolved[source]) image.src = resolved[source];
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
  }
}

function applyDocument(documentData, preserveScroll = false) {
  const previousScroll = viewer.scrollTop;
  const previousHeight = Math.max(1, viewer.scrollHeight - viewer.clientHeight);
  const scrollRatio = previousScroll / previousHeight;
  renderVersion += 1;
  documentSearch.clear();
  closeSearch();
  currentDocument = documentData;
  content.classList.remove('welcome');
  content.innerHTML = renderMarkdown(documentData.content);
  document.title = `${documentData.name} — EDON MDView`;
  $('#document-name').textContent = documentData.name;
  $('#document-name').title = documentData.path;
  $('#status-path').textContent = documentData.path;
  $('#status-path').title = documentData.path;
  $('#status-text').textContent = 'Aggiornamento automatico attivo';
  $('#export-button').disabled = false;
  $('#print-button').disabled = false;
  buildToc();
  updateStats();
  updateSearchCount();
  resolveImages(renderVersion).catch((error) => showToast(error.message, 'warning'));
  requestAnimationFrame(() => {
    if (preserveScroll) {
      viewer.scrollTop = Math.min(previousScroll, Math.round(scrollRatio * Math.max(0, viewer.scrollHeight - viewer.clientHeight)));
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
    const clone = content.cloneNode(true);
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
$('#search-close').addEventListener('click', closeSearch);
$('#search-next').addEventListener('click', () => { documentSearch.activate(documentSearch.current + 1); updateSearchCount(); });
$('#search-previous').addEventListener('click', () => { documentSearch.activate(documentSearch.current - 1); updateSearchCount(); });
$('#export-button').addEventListener('click', exportDocument);
$('#print-button').addEventListener('click', () => window.mdview.printDocument());
$('#shortcuts-button').addEventListener('click', () => shortcutsDialog.showModal());
$('#shortcuts-close').addEventListener('click', () => shortcutsDialog.close());
shortcutsDialog.addEventListener('click', (event) => {
  if (event.target === shortcutsDialog) shortcutsDialog.close();
});

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    documentSearch.search(searchInput.value);
    updateSearchCount();
  }, 120);
});
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    documentSearch.activate(documentSearch.current + (event.shiftKey ? -1 : 1));
    updateSearchCount();
  }
});

toc.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-target]');
  if (!link) return;
  event.preventDefault();
  const heading = document.getElementById(link.dataset.target);
  heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  history.replaceState(null, '', `#${encodeURIComponent(link.dataset.target)}`);
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

viewer.addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    updateScrollState();
    scrollTicking = false;
  });
});

window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  $('#drag-overlay').hidden = false;
});
window.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drag-overlay').hidden = true;
});
window.addEventListener('drop', async (event) => {
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
  if (event.key === 'Escape' && !searchPanel.hidden) closeSearch();
  if (event.key === 'F3' && !searchPanel.hidden) {
    event.preventDefault();
    documentSearch.activate(documentSearch.current + (event.shiftKey ? -1 : 1));
    updateSearchCount();
  }
});

window.mdview.onDocumentLoaded((documentData) => applyDocument(documentData));
window.mdview.onDocumentChanged((documentData) => {
  applyDocument(documentData, true);
  showToast('Documento aggiornato');
});
window.mdview.onNotification(({ type, message }) => showToast(message, type));
window.mdview.onSearchOpen(openSearch);
window.mdview.onToggleSidebar(toggleSidebar);
window.mdview.onToggleTheme(() => setTheme(currentTheme === 'dark' ? 'light' : 'dark'));
window.mdview.onZoom((delta) => setZoom(delta === 0 ? 1 : zoom + delta));
window.mdview.onExportRequest(exportDocument);
window.mdview.onPrintRequest(() => window.mdview.printDocument());
window.mdview.onShortcuts(() => shortcutsDialog.showModal());

setTheme(currentTheme);
setZoom(Number.isFinite(zoom) ? zoom : 1);
if (!sidebarVisible) {
  sidebarVisible = true;
  toggleSidebar();
}
