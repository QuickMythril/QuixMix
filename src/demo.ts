import type { Playlist, ResourceClient, ResourceRef } from './model';
const ref = (service: ResourceRef['service'], identifier: string): ResourceRef => ({service, name: 'MusicDemo', identifier});
const lyrics = { ...ref('FILE', 'lyrics'), service: 'FILE' as const, format: 'vtt' as const, language: 'en' };
const commentary = { ...lyrics, identifier: 'commentary' };
export const demoPlaylist: Playlist = {
  kind: 'qortium-music-playlist', schemaVersion: 1, title: 'First light · a player demo',
  tracks: [
    { id:'first-light', title:'First light', artist:'Music · synthetic demo', defaultVersion:'video', switchPolicy:'aligned',
      versions:{audio:{resource:ref('AUDIO','audio')},video:{resource:ref('VIDEO','video')}}, cover:ref('IMAGE','cover'), lyrics, commentary },
    { id:'quiet-morning', title:'Quiet morning', artist:'Audio & cover demonstration', defaultVersion:'audio', switchPolicy:'restart',
      versions:{audio:{resource:ref('AUDIO','audio')}}, cover:ref('IMAGE','cover'), lyrics, commentary },
    { id:'moving-colors', title:'Moving colors', artist:'Video-only demonstration', defaultVersion:'video', switchPolicy:'restart',
      versions:{video:{resource:ref('VIDEO','video')}}, lyrics, commentary },
  ],
};
const files: Record<string,string> = {audio:'first-light.mp3',video:'first-light.mp4',cover:'cover.svg',lyrics:'lyrics.vtt',commentary:'commentary.vtt'};
function url(ref:ResourceRef) { const file=files[ref.identifier]; if(ref.name!=='MusicDemo'||!file) throw new Error('Unknown demo resource.'); return `${import.meta.env.BASE_URL}demo/${file}`; }
export const demoClient:ResourceClient = {
  async mediaUrl(ref, signal) { signal?.throwIfAborted(); return url(ref); },
  async text(ref, signal) { const response=await fetch(url(ref),{signal}); if(!response.ok) throw new Error('Demo file could not load.'); return response.text(); },
};
