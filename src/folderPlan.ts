import type { ImportedAlbum, ImportAsset } from './folderImport';
import { subtitleToVtt } from './folderImport';
import type { Playlist, ResourceClient, ResourceRef, TextRef } from './model';
import { parsePlaylist } from './schema';

export interface PlannedFile { ref: ResourceRef; file: File; path: string }
export interface FolderPlan { playlist: Playlist; files: PlannedFile[]; identifier: string }

export async function planFolder(album: ImportedAlbum): Promise<FolderPlan> {
  if (!album.tracks.length) throw new Error('No audio or video tracks found. Choose the album folder containing your media.');
  const prefix = `quixmix-${Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const files: PlannedFile[] = [];
  const bySource = new Map<string, ResourceRef>();
  async function add(asset: ImportAsset | undefined, service: ResourceRef['service']): Promise<ResourceRef | undefined> {
    if (!asset) return undefined;
    const key = `${service}:${asset.path}`;
    const existing = bySource.get(key);
    if (existing) return existing;
    let file = asset.file;
    if (service === 'FILE') {
      if (file.size > 1024 * 1024) throw new Error(`${asset.path}: subtitles exceed 1 MiB.`);
      const text = subtitleToVtt(await file.text(), file.name);
      file = new File([text], file.name.replace(/\.(srt|vtt)$/i, '.vtt'), { type: 'text/vtt' });
    }
    const ref: ResourceRef = { service, name: 'LocalFolder', identifier: `${prefix}-${files.length + 1}` };
    files.push({ ref, file, path: asset.path });
    bySource.set(key, ref);
    return ref;
  }
  const textRef = async (asset?: ImportAsset): Promise<TextRef | undefined> => {
    const ref = await add(asset, 'FILE');
    return ref ? { ...ref, service: 'FILE', format: 'vtt' } : undefined;
  };
  const playlist: Playlist = { kind: 'qortium-music-playlist', schemaVersion: 1, title: album.title, tracks: [] };
  for (const track of album.tracks) {
    const audio = await add(track.audio, 'AUDIO'), video = await add(track.video, 'VIDEO');
    playlist.tracks.push({
      id: track.id, title: track.title, artist: track.artist.trim() || 'Unknown artist', defaultVersion: video ? 'video' : 'audio',
      switchPolicy: track.switchPolicy, cover: await add(track.cover, 'IMAGE'),
      versions: {
        ...(audio ? { audio: { resource: audio, lyrics: await textRef(track.audioLyrics), commentary: await textRef(track.audioCommentary) } } : {}),
        ...(video ? { video: { resource: video, lyrics: await textRef(track.videoLyrics), commentary: await textRef(track.videoCommentary) } } : {}),
      },
    });
  }
  return { playlist: parsePlaylist(playlist), files, identifier: prefix };
}

export function forPublisher(plan: FolderPlan, name: string, title: string): FolderPlan {
  const playlist = structuredClone(plan.playlist);
  playlist.title = title.trim() || plan.playlist.title;
  for (const track of playlist.tracks) {
    if (track.cover) track.cover.name = name;
    for (const version of Object.values(track.versions)) {
      version.resource.name = name;
      if (version.lyrics) version.lyrics.name = name;
      if (version.commentary) version.commentary.name = name;
    }
  }
  return { ...plan, playlist: parsePlaylist(playlist), files: plan.files.map(item => ({ ...item, ref: { ...item.ref, name } })) };
}

export function previewFolder(plan: FolderPlan): { client: ResourceClient; cleanup: () => void } {
  const files = new Map(plan.files.map(item => [item.ref.identifier, item.file]));
  const urls = new Map<string, string>();
  const get = (ref: ResourceRef) => {
    const file = files.get(ref.identifier);
    if (!file) throw new Error('This file is no longer selected. Choose the album folder again.');
    return file;
  };
  return {
    client: {
      async mediaUrl(ref, signal) { signal?.throwIfAborted(); if (!urls.has(ref.identifier)) urls.set(ref.identifier, URL.createObjectURL(get(ref))); return urls.get(ref.identifier)!; },
      async text(ref, signal) { signal?.throwIfAborted(); return get(ref).text(); },
    },
    cleanup: () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); },
  };
}
