'use strict';
// Alleen de eigen, lokale pagina's (instellen / geen verbinding) krijgen toegang tot de app-functies.
// De ADONIS-website zelf draait als gewone webpagina zonder extra rechten.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'http:' || location.protocol === 'https:') {
  // De ADONIS-website krijgt alleen "afdrukken met voorbeeld" (de app controleert dat het de eigen server is).
  contextBridge.exposeInMainWorld('adonisApp', {
    print: () => ipcRenderer.invoke('adonis:print'),
    // De server is net bijgewerkt: meteen kijken of de app mee moet (de app volgt de versie van de server).
    checkUpdate: () => ipcRenderer.invoke('adonis:update-check'),
    // Websites uit het Portaal binnen ADONIS openen (eigen venster), of toch in de gewone browser.
    openSite: (url, title) => ipcRenderer.invoke('adonis:open-site', url, title),
    openExternal: (url) => ipcRenderer.invoke('adonis:open-external', url),
    webview: true,
  });
} else if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('adonisApp', {
    // Hoekje "ADONIS bijwerken" (update.html)
    onUpdateState: (cb) => ipcRenderer.on('adonis:update-state', (_e, s) => cb(s)),
    updateRestart: () => ipcRenderer.invoke('adonis:update-restart'),
    updateHide: () => ipcRenderer.invoke('adonis:update-hide'),
    getConfig: () => ipcRenderer.invoke('adonis:get-config'),
    saveUrl: (url) => ipcRenderer.invoke('adonis:save-url', url),
    open: () => ipcRenderer.invoke('adonis:open'),
    setup: () => ipcRenderer.invoke('adonis:setup'),
    openExternal: (url) => ipcRenderer.invoke('adonis:open-external', url), // site.html: "Openen in browser"
  });
}
