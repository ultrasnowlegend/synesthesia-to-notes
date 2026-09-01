import type { AppBridge } from '../electron/shared.js';

declare global {
  interface Window {
    app: AppBridge;
  }
}

export {};
