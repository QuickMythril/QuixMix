export type BridgeState = {
  actions: string[];
  isHomeBridge: boolean;
  ui: string;
};

export type NodeApiFetchResult = {
  body: string;
  contentLength?: number;
  contentType: string;
  data: unknown;
  ok: boolean;
  status: number;
  statusText: string;
};

export type QdnResource = {
  created?: number;
  description?: string;
  identifier?: string;
  name?: string;
  service?: string;
  size?: number;
  status?: string;
  title?: string;
  updated?: number;
  [key: string]: unknown;
};

export type NodeStatus = {
  height?: number;
  isSynchronizing?: boolean;
  numberOfConnections?: number;
  syncPercent?: number;
  syncPhase?: string;
  [key: string]: unknown;
};
