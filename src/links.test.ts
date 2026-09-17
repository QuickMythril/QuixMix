import { describe, expect, it } from 'vitest';
import { appCoordinate, parsePlaylistRoute, playlistHash, playlistLink } from './links';

describe('playlist links', () => {
  it('round-trips names and identifiers through the hash route', () => {
    const ref = { name: 'Quick Mythril', identifier: 'quixmix-list-abc/1?x#y' };
    const hash = playlistHash(ref);
    expect(hash).toBe('#/playlist/Quick%20Mythril/quixmix-list-abc%2F1%3Fx%23y');
    expect(parsePlaylistRoute(hash)).toEqual(ref);
    expect(parsePlaylistRoute('#/playlist/Name/default/')).toEqual({ name: 'Name', identifier: 'default' });
    expect(parsePlaylistRoute('#playlist/Name/default')).toEqual({ name: 'Name', identifier: 'default' });
  });
  it('rejects routes that are not a playlist coordinate', () => {
    for (const hash of ['', '#', '#/', '#/playlist', '#/playlist/Name', '#/playlist/Name/', '#/playlist//x', '#/playlist/Name/id/extra', '#/playlist/%E0%A4%A/x', '#/playlist/ Name/x', '#/playlist/Name/..', '#/track/Name/x', '#/playlist/Na%00me/x']) {
      expect(parsePlaylistRoute(hash), hash).toBeNull();
    }
  });
  it('derives the app coordinate from a Home render path with a safe fallback', () => {
    expect(appCoordinate('/render/APP/QuixMix/QuixMix/')).toEqual({ service: 'APP', name: 'QuixMix', identifier: 'QuixMix' });
    expect(appCoordinate('/render/app/My%20Fork/dev/index.html')).toEqual({ service: 'APP', name: 'My Fork', identifier: 'dev' });
    expect(appCoordinate('/')).toEqual({ service: 'APP', name: 'QuixMix', identifier: 'QuixMix' });
  });
  it('builds qdn links inside Home and page links outside it', () => {
    const ref = { name: 'Owner', identifier: 'quixmix-list-1' };
    expect(playlistLink(ref, { origin: 'http://127.0.0.1:24891', pathname: '/render/APP/QuixMix/QuixMix/' }, true)).toBe('qdn://APP/QuixMix/QuixMix#/playlist/Owner/quixmix-list-1');
    expect(playlistLink(ref, { origin: 'http://localhost:5173', pathname: '/' }, false)).toBe('http://localhost:5173/#/playlist/Owner/quixmix-list-1');
  });
});
