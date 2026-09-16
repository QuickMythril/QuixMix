export type MediaKind = 'audio' | 'video';
export type ResourceService = 'PLAYLIST' | 'AUDIO' | 'VIDEO' | 'IMAGE' | 'FILE';
export interface ResourceRef {
  service: ResourceService;
  name: string;
  identifier: string;
  path?: string;
}
export interface TextRef extends ResourceRef {
  service: 'FILE';
  format: 'vtt';
  language?: string;
  offsetMs?: number;
}
export interface MediaVersion {
  resource: ResourceRef;
  timelineOffsetMs?: number;
  lyrics?: TextRef | null;
  commentary?: TextRef | null;
}
export interface Track {
  id: string;
  title: string;
  artist: string;
  defaultVersion: MediaKind;
  switchPolicy: 'aligned' | 'restart';
  versions: Partial<Record<MediaKind, MediaVersion>>;
  cover?: ResourceRef;
  lyrics?: TextRef;
  commentary?: TextRef;
}
export interface Playlist {
  kind: 'qortium-music-playlist';
  schemaVersion: 1;
  title: string;
  tracks: Track[];
}
export interface Cue { id: string; start: number; end: number; text: string }
export interface ResourceClient {
  mediaUrl(ref: ResourceRef, signal?: AbortSignal): Promise<string>;
  text(ref: ResourceRef, signal?: AbortSignal): Promise<string>;
}
