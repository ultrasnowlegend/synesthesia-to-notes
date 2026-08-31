import type { MostAplikace } from '../electron/sdilene.js';

declare global {
  interface Window {
    aplikace: MostAplikace;
  }
}

export {};
