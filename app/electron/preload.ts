import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { MostAplikace } from './sdilene.js';

const most: MostAplikace = {
  vyberVideo: () => ipcRenderer.invoke('syn2noty:vyber-video'),
  prepis: (cesta, nastaveni) => ipcRenderer.invoke('syn2noty:prepis', cesta, nastaveni),
  prekvantuj: (nastaveni) => ipcRenderer.invoke('syn2noty:prekvantuj', nastaveni),
  strana: (cislo) => ipcRenderer.invoke('syn2noty:strana', cislo),
  export: (typ) => ipcRenderer.invoke('syn2noty:export', typ),
  otevriSlozku: (cesta) => ipcRenderer.invoke('syn2noty:otevri-slozku', cesta),
  cestaSouboru: (soubor) => webUtils.getPathForFile(soubor),
  naStav: (posluchac) => {
    const obal = (_e: unknown, zprava: string): void => posluchac(zprava);
    ipcRenderer.on('syn2noty:stav', obal);
    return () => ipcRenderer.off('syn2noty:stav', obal);
  },
};

contextBridge.exposeInMainWorld('aplikace', most);
