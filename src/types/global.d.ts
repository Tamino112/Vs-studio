import type { vsApi } from '../../electron/preload';

declare global {
  interface Window {
    vsApi: typeof vsApi;
  }
}

export {};
