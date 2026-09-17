import { expect, test, type Page } from '@playwright/test';

function playlist(title: string, track: string) {
  return { kind: 'qortium-music-playlist', schemaVersion: 1, title, tracks: [{ id: 't1', title: track, artist: 'Tester', defaultVersion: 'audio', switchPolicy: 'restart', versions: { audio: { resource: { service: 'AUDIO', name: 'Owner', identifier: `${title}-audio` } } } }] };
}

async function installLibraryBridge(page: Page) {
  await page.addInitScript(({ first, second }) => {
    const w = window as typeof window & { requests?: string[]; qdnRequest?: (r: Record<string, unknown>) => Promise<unknown> };
    w.requests = [];
    w.qdnRequest = async (r) => {
      const action = String(r.action);
      w.requests!.push(action);
      if (action === 'SHOW_ACTIONS') return ['GET_SELECTED_ACCOUNT', 'GET_ACCOUNT_NAMES', 'SEARCH_QDN_RESOURCES', 'FETCH_QDN_RESOURCE', 'GET_QDN_RESOURCE_STATUS', 'GET_QDN_RESOURCE_URL'];
      if (action === 'WHICH_UI') return 'QORTIUM_HOME';
      if (action === 'GET_SELECTED_ACCOUNT') return { address: 'QOwner' };
      if (action === 'GET_ACCOUNT_NAMES') return [{ name: 'Owner' }];
      if (action === 'SEARCH_QDN_RESOURCES') return [
        { name: 'Owner', service: 'PLAYLIST', identifier: 'quixmix-list-second', created: 2 },
        { name: 'Owner', service: 'PLAYLIST', identifier: 'quixmix-list-first', created: 1 },
      ];
      if (action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      if (action === 'FETCH_QDN_RESOURCE') return btoa(JSON.stringify(r.identifier === 'quixmix-list-first' ? first : second));
      if (action === 'GET_QDN_RESOURCE_URL') return '/demo/missing.mp3';
      throw new Error(`Unexpected bridge action ${action}`);
    };
  }, { first: playlist('First album', 'Opening song'), second: playlist('Second album', 'Later song') });
}

test('Listen lists the selected account\'s playlists by default and opens one on click', async ({ page }) => {
  await installLibraryBridge(page);
  await page.goto('/');
  const library = page.getByRole('region', { name: 'Your playlists' });
  await expect(library.getByRole('heading', { name: 'Published by Owner' })).toBeVisible();
  const items = library.getByRole('button', { name: /album/ });
  await expect(items).toHaveText([/Second album.*1 track/, /First album.*1 track/]);
  // Listing never touches a write or permissioned action.
  expect(await page.evaluate(() => (window as any).requests)).not.toContain('PUBLISH_QDN_RESOURCE');
  await items.nth(1).click();
  await expect(page.locator('.intro h1')).toHaveText('First album');
  await expect(page.getByRole('heading', { name: 'Opening song', exact: true })).toBeVisible();
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => window.location.hash)).toBe('#/playlist/Owner/quixmix-list-first');
  await expect(page.locator('.share-link code')).toHaveText('qdn://APP/QuixMix/QuixMix#/playlist/Owner/quixmix-list-first');
  await page.getByRole('button', { name: 'Load demo' }).click();
  expect(await page.evaluate(() => window.location.hash)).toBe('');
});

test('a direct link opens the playlist on load and the link can be copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installLibraryBridge(page);
  await page.goto('/#/playlist/Owner/quixmix-list-second');
  await expect(page.locator('.intro h1')).toHaveText('Second album');
  await expect(page.getByRole('heading', { name: 'Later song', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('qdn://APP/QuixMix/QuixMix#/playlist/Owner/quixmix-list-second');
  // Changing the address while open follows the new playlist.
  await page.evaluate(() => { window.location.hash = '#/playlist/Owner/quixmix-list-first'; });
  await expect(page.locator('.intro h1')).toHaveText('First album');
});

test('without Home the library stays hidden and a bad link is ignored', async ({ page }) => {
  await page.goto('/#/playlist/Owner');
  await expect(page.locator('.intro h1')).toHaveText('First light · a player demo');
  await expect(page.getByRole('region', { name: 'Your playlists' })).toHaveCount(0);
});
