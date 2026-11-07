'use strict';
// Alleen de eigen, lokale pagina's (instellen / geen verbinding) krijgen toegang tot de app-functies.
// De ADONIS-website zelf draait als gewone webpagina zonder extra rechten.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('adonisApp', {
    getConfig: () => ipcRenderer.invoke('adonis:get-config'),
    saveUrl: (url) => ipcRenderer.invoke('adonis:save-url', url),
    open: () => ipcRenderer.invoke('adonis:open'),
    setup: () => ipcRenderer.invoke('adonis:setup'),
  });
}
