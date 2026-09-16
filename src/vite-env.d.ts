/// <reference types="vite/client" />

import type { QdnRequest } from './qdnRequest';

declare global {
  interface Window {
    qdnRequest?: <T = unknown>(request: QdnRequest) => Promise<T>;
  }
}
