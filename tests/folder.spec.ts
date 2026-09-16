import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let root: string;
const srt = (text: string) => `1\n00:00:00,000 --> 00:00:15,000\n${text}\n`;
test.beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'quixmix-folder-')); });
test.afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function albumFiles() {
  await copyFile('public/demo/first-light.mp3', path.join(root, '02 - Artist - Early.mp3'));
  await copyFile('public/demo/first-light.mp4', path.join(root, '02 - Artist - Early.mp4'));
  await writeFile(path.join(root, '02 - Artist - Early.audio.en.srt'), srt('Audio version lyrics'));
  await writeFile(path.join(root, '02 - Artist - Early.video.en.srt'), srt('Video version lyrics'));
  await copyFile('public/demo/first-light.mp3', path.join(root, '10 - Artist - Later.mp3'));
  await writeFile(path.join(root, 'notes.txt'), 'Not playlist media');
}
async function choose(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
  await page.getByLabel('Choose album folder', { exact: true }).setInputFiles(root);
  await expect(page.getByRole('button', { name: 'Preview album', exact: true })).toBeVisible();
}
test('folder import sorts tracks, previews separate SRT versions and keeps the review when returning', async ({ page }) => {
  await albumFiles(); await page.goto('/'); await choose(page);
  await expect(page.locator('.folder-track-title strong')).toHaveText(['Early', 'Later']);
  await expect(page.locator('.advanced-editor')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Preview album', exact: true }).click();
  await expect(page.getByTestId('lyrics-overlay')).toContainText('Video version lyrics');
  await page.getByLabel('Audio only', { exact: true }).check();
  await expect(page.getByTestId('lyrics-overlay')).toContainText('Audio version lyrics');
  await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
  await expect(page.locator('.folder-track-title strong')).toHaveText(['Early', 'Later']);
});
test('an invalid replacement folder preserves the current import', async ({ page }) => {
  await albumFiles(); await page.goto('/'); await choose(page);
  const invalid = path.join(root, 'invalid'); await mkdir(invalid); await writeFile(path.join(invalid, 'readme.txt'), 'No music');
  await page.getByLabel('Choose album folder', { exact: true }).setInputFiles(invalid);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.folder-track-title strong')).toHaveText(['Early', 'Later']);
});
test('guided publishing waits for every resource before the playlist and resumes after rejection', async ({ page }) => {
  await albumFiles();
  await page.addInitScript(() => {
    const w = window as any;
    const actions = ['GET_SELECTED_ACCOUNT', 'GET_ACCOUNT_NAMES', 'PUBLISH_QDN_RESOURCE', 'STAGE_QDN_PUBLISH_SOURCE', 'SELECT_QDN_PUBLISH_SOURCE'];
    w.published = []; w.staged = []; let rejected = false; const signatures: Record<string, string> = {};
    w.qdnRequest = async (r: any) => {
      if (r.action === 'SHOW_ACTIONS') return actions;
      if (r.action === 'GET_SELECTED_ACCOUNT') return { address: 'QFolder' };
      if (r.action === 'GET_ACCOUNT_NAMES') return [{ name: 'FolderOwner' }];
      if (r.action === 'STAGE_QDN_PUBLISH_SOURCE') { w.staged.push(r.fileName); return { sourceToken: `token-${w.staged.length}` }; }
      if (r.action === 'PUBLISH_QDN_RESOURCE') {
        if (w.published.length === 1 && !rejected) { rejected = true; return { accepted: false, error: 'Test rejection' }; }
        const sig = `sig-${r.identifier}`; signatures[r.identifier] = sig; w.published.push({ service: r.service, identifier: r.identifier }); return { accepted: true, transactionSignature: sig };
      }
      if (r.action === 'LIST_QDN_RESOURCES') return [{ name: r.name, identifier: r.identifier, latestSignature: signatures[r.identifier] }];
      if (r.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      throw Error(`Unexpected bridge action ${r.action}`);
    };
  });
  await page.goto('/'); await choose(page);
  await page.getByRole('button', {name:'Connect Home account'}).click();
  await page.getByRole('button', {name:'Publish album',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Test rejection');
  await page.getByRole('button', {name:'Resume publishing',exact:true}).click();
  await expect(page.getByRole('button', {name:'Published',exact:true})).toBeVisible();
  const published = await page.evaluate(() => (window as any).published);
  expect(published.map((p: any) => p.service)).toEqual(['AUDIO', 'VIDEO', 'FILE', 'FILE', 'AUDIO', 'PLAYLIST']);
  expect(new Set(published.map((p: any) => p.identifier)).size).toBe(published.length);
});
