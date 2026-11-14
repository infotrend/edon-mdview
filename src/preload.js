const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

const subscribe = (channel, callback) => {
  const listener = (event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('mdview', {
  // Language and version, read once before the first paint.
  bootstrap: () => ipcRenderer.sendSync('app:bootstrap'),
  // Opens the product website: the address is fixed in the main process, the page cannot supply one.
  openWebsite: () => ipcRenderer.invoke('app:open-website'),
  chooseDocument: () => ipcRenderer.invoke('document:choose'),
  openDocument: (filePath) => ipcRenderer.invoke('document:open-path', filePath),
  openRelative: (reference) => ipcRenderer.invoke('document:open-relative', reference),
  reloadDocument: () => ipcRenderer.invoke('document:reload'),
  // Saving never carries a path: the main process writes to the open document or asks the user where.
  saveDocument: (content) => ipcRenderer.invoke('document:save', content),
  saveDocumentAs: (content) => ipcRenderer.invoke('document:save-as', content),
  confirmUnsaved: () => ipcRenderer.invoke('document:confirm-unsaved'),
  chooseImage: () => ipcRenderer.invoke('document:choose-image'),
  setDirty: (dirty) => ipcRenderer.send('document:dirty', Boolean(dirty)),
  reportSaveResult: (id, saved) => ipcRenderer.send('document:save-result', { id, saved: Boolean(saved) }),
  printDocument: () => ipcRenderer.invoke('document:print'),
  exportDocument: (html) => ipcRenderer.invoke('document:export', html),
  resolveResources: (sources) => ipcRenderer.invoke('document:resolve-resources', sources),
  embedImages: (sources) => ipcRenderer.invoke('document:embed-images', sources),
  pathForFile: (file) => webUtils.getPathForFile(file),
  setZoom: (factor) => webFrame.setZoomFactor(factor),
  onDocumentLoaded: (callback) => subscribe('document:loaded', callback),
  onDocumentChanged: (callback) => subscribe('document:changed', callback),
  onNotification: (callback) => subscribe('app:notification', callback),
  onSearchOpen: (callback) => subscribe('search:open', callback),
  onToggleSidebar: (callback) => subscribe('view:toggle-sidebar', callback),
  onToggleTheme: (callback) => subscribe('view:toggle-theme', callback),
  onZoom: (callback) => subscribe('view:zoom', callback),
  onExportRequest: (callback) => subscribe('document:export-request', callback),
  onPrintRequest: (callback) => subscribe('document:print-request', callback),
  onShortcuts: (callback) => subscribe('help:shortcuts', callback),
  onAbout: (callback) => subscribe('help:about', callback),
  onLanguageChanged: (callback) => subscribe('language:changed', callback),
  onSaveRequest: (callback) => subscribe('document:save-request', callback),
  onSaveAsRequest: (callback) => subscribe('document:save-as-request', callback),
  onEditToggle: (callback) => subscribe('edit:toggle', callback),
  onEditCommand: (callback) => subscribe('edit:command', callback),
});
