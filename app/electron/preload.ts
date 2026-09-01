import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { AppBridge } from './shared.js';

const bridge: AppBridge = {
  pickVideo: () => ipcRenderer.invoke('app:pick-video'),
  transcribe: (path, options) => ipcRenderer.invoke('app:transcribe', path, options),
  requantise: (options) => ipcRenderer.invoke('app:requantise', options),
  page: (number) => ipcRenderer.invoke('app:page', number),
  save: (kind) => ipcRenderer.invoke('app:save', kind),
  revealInFolder: (path) => ipcRenderer.invoke('app:reveal', path),
  filePath: (file) => webUtils.getPathForFile(file),
  onStatus: (listener) => {
    const handler = (_e: unknown, message: string): void => listener(message);
    ipcRenderer.on('app:status', handler);
    return () => {
      ipcRenderer.off('app:status', handler);
    };
  },
};

contextBridge.exposeInMainWorld('app', bridge);
