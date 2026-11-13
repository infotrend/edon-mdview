const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

const subscribe = (channel, callback) => {
  const listener = (event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('mdview', {
  chooseDocument: () => ipcRenderer.invoke('document:choose'),
  openDocument: (filePath) => ipcRenderer.invoke('document:open-path', filePath),
  openRelative: (reference) => ipcRenderer.invoke('document:open-relative', reference),
  reloadDocument: () => ipcRenderer.invoke('document:reload'),
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
});
