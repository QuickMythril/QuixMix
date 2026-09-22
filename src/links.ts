import type { ResourceRef } from './model';

/** Direct-link route for a published playlist: `#/playlist/<name>/<identifier>`. */
export interface PlaylistRoute { name: string; identifier: string; commentary?: boolean }

const SEGMENT = /[\x00-\x1f\x7f]/;

function segment(value: string | undefined): string | null {
  if (value === undefined) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (!decoded.trim() || decoded !== decoded.trim() || SEGMENT.test(decoded) || decoded === '.' || decoded === '..') return null;
  return decoded;
}

export function parsePlaylistRoute(hash: string): PlaylistRoute | null {
  const raw = hash.replace(/^#\/?/, '');
  const queryStart = raw.indexOf('?');
  const route = queryStart < 0 ? raw : raw.slice(0, queryStart);
  const options = new URLSearchParams(queryStart < 0 ? '' : raw.slice(queryStart + 1));
  const commentary = options.getAll('commentary').length === 1 && options.get('commentary') === 'true';
  const parts = route.split('/');
  if (parts[0] !== 'playlist' || parts.length < 3 || parts.length > 4 || (parts.length === 4 && parts[3] !== '')) return null;
  const name = segment(parts[1]), identifier = segment(parts[2]);
  return name && identifier ? { name, identifier, ...(commentary ? { commentary: true } : {}) } : null;
}

export function playlistHash(ref: Pick<ResourceRef, 'name' | 'identifier'>, commentary = false): string {
  return `#/playlist/${encodeURIComponent(ref.name)}/${encodeURIComponent(ref.identifier)}${commentary ? '?commentary=true' : ''}`;
}

/** The app's own QDN coordinate, read from a Home render path, else the default publication. */
export function appCoordinate(pathname: string): { service: string; name: string; identifier: string } {
  const match = /\/render\/([A-Za-z_]+)\/([^/]+)\/([^/]+)/.exec(pathname);
  if (match) {
    try { return { service: match[1].toUpperCase(), name: decodeURIComponent(match[2]), identifier: decodeURIComponent(match[3]) }; } catch { /* fall through */ }
  }
  return { service: 'APP', name: 'QuixMix', identifier: 'QuixMix' };
}

/** A shareable link: `qdn://` inside Home, otherwise the current page with the route. */
export function playlistLink(ref: Pick<ResourceRef, 'name' | 'identifier'>, location: { pathname: string; origin: string }, inHome: boolean, commentary = false): string {
  const hash = playlistHash(ref, commentary);
  if (!inHome) return `${location.origin}${location.pathname}${hash}`;
  const app = appCoordinate(location.pathname);
  return `qdn://${app.service}/${encodeURIComponent(app.name)}/${encodeURIComponent(app.identifier)}${hash}`;
}
